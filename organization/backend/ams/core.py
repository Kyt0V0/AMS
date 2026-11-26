from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable, Iterator

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .db import utcnow
from .models import AuditLog, Session, Setting, User
from .mail import Mailer
from .ratelimit import Limits, RateLimiter
from .security import ServerKeys, hash_secret, hash_token, new_token, verify_secret

COOKIE_SECURE = "__Host-ams_session"
COOKIE_PLAIN = "ams_session"

DEFAULT_POLICY: dict[str, Any] = {
    "kdf_time_cost": 3,
    "kdf_memory_kib": 65536,
    "kdf_parallelism": 1,
    "min_password_length": 12,
    "password_max_age_days": 180,
    "vault_timeout_minutes": 10,
    "open_registration": False,
    "require_two_factor": False,
}


@dataclass
class AppContext:
    settings: Settings
    keys: ServerKeys
    session_factory: sessionmaker
    mailer: Mailer = field(default_factory=Mailer)
    limits: Limits = field(default_factory=Limits)


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def get_db(request: Request) -> Iterator[DbSession]:
    db = request.app.state.ctx.session_factory()
    try:
        yield db
    finally:
        db.close()


def client_ip(request: Request) -> str:
    ctx: AppContext = request.app.state.ctx
    if ctx.settings.behind_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def is_secure_request(request: Request) -> bool:
    settings: Settings = request.app.state.ctx.settings
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    if settings.behind_proxy and request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
        return True
    return request.url.scheme == "https"


def _cookie_name(request: Request) -> str:
    return COOKIE_SECURE if is_secure_request(request) else COOKIE_PLAIN


def enforce_limit(limiter: RateLimiter, key: str) -> None:
    wait = limiter.retry_after(key)
    if wait:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait and try again.",
            headers={"Retry-After": str(wait)},
        )


def audit(
    db: DbSession,
    request: Request,
    action: str,
    actor_id: str | None = None,
    target: str | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target=target,
            detail=detail[:300] if detail else None,
            ip=client_ip(request),
        )
    )


def get_policy(db: DbSession) -> dict[str, Any]:
    policy = dict(DEFAULT_POLICY)
    row = db.get(Setting, "policy")
    if row:
        stored = json.loads(row.value)
        policy.update({k: v for k, v in stored.items() if k in DEFAULT_POLICY})
    return policy


def save_policy(db: DbSession, updates: dict[str, Any]) -> dict[str, Any]:
    policy = get_policy(db)
    policy.update(updates)
    row = db.get(Setting, "policy")
    if row:
        row.value = json.dumps(policy)
    else:
        db.add(Setting(key="policy", value=json.dumps(policy)))
    return policy


def start_session(db: DbSession, request: Request, response: Response, user: User) -> Session:
    ctx: AppContext = request.app.state.ctx
    now = utcnow()
    idle_cutoff = now - timedelta(minutes=ctx.settings.session_idle_minutes)
    db.execute(delete(Session).where(or_(Session.expires_at < now, Session.last_seen_at < idle_cutoff)))

    token = new_token()
    session = Session(
        token_hash=hash_token(token),
        user_id=user.id,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=ctx.settings.session_max_hours),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:256],
    )
    db.add(session)
    secure = is_secure_request(request)
    response.set_cookie(
        COOKIE_SECURE if secure else COOKIE_PLAIN,
        token,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )
    return session


def clear_session_cookie(request: Request, response: Response) -> None:
    secure = is_secure_request(request)
    response.delete_cookie(
        COOKIE_SECURE if secure else COOKIE_PLAIN, path="/", httponly=True, secure=secure, samesite="strict"
    )


@dataclass
class Auth:
    user: User
    session: Session


def current_auth(request: Request, db: DbSession = Depends(get_db)) -> Auth:
    ctx: AppContext = request.app.state.ctx
    token = request.cookies.get(_cookie_name(request))
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")

    session = db.scalar(select(Session).where(Session.token_hash == hash_token(token)))
    now = utcnow()
    idle = timedelta(minutes=ctx.settings.session_idle_minutes)
    if session is None or now >= session.expires_at or now - session.last_seen_at >= idle:
        if session is not None:
            db.delete(session)
            db.commit()
        raise HTTPException(status_code=401, detail="Session expired")

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="Not signed in")

    if now - session.last_seen_at > timedelta(seconds=60):
        session.last_seen_at = now
        db.commit()
    return Auth(user=user, session=session)


def require_roles(*roles: str) -> Callable[..., Auth]:
    def dependency(auth: Auth = Depends(current_auth)) -> Auth:
        if auth.user.role not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission to do that")
        return auth

    return dependency


require_admin = require_roles("admin")
require_editor = require_roles("admin", "editor")


def require_reauth(ctx: AppContext, user: User, auth_key: str) -> None:
    enforce_limit(ctx.limits.login_user, user.username_lookup)
    if not verify_secret(user.auth_hash, auth_key):
        ctx.limits.login_user.hit(user.username_lookup)
        raise HTTPException(status_code=403, detail="Current password is incorrect")


def other_active_admins(db: DbSession, user_id: str) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == "admin", User.is_active, User.id != user_id)
    )


def revoke_sessions(db: DbSession, user_id: str, keep_session_id: str | None = None) -> int:
    stmt = delete(Session).where(Session.user_id == user_id)
    if keep_session_id:
        stmt = stmt.where(Session.id != keep_session_id)
    return db.execute(stmt).rowcount


def session_payload(ctx: AppContext, db: DbSession, auth: Auth) -> dict[str, Any]:
    user = auth.user
    return {
        "user": {
            "id": user.id,
            "username": ctx.keys.decrypt(user.username_enc),
            "email": ctx.keys.decrypt(user.email_enc),
            "role": user.role,
            "can_share": user.can_share,
            "can_edit_profile": user.can_edit_profile,
            "preferred_language": user.preferred_language,
            "two_factor_enabled": user.two_factor_enabled,
            "created_at": user.created_at,
            "password_changed_at": user.password_changed_at,
        },
        "kdf": {
            "salt": user.kdf_salt,
            "time_cost": user.kdf_time_cost,
            "memory_kib": user.kdf_memory_kib,
            "parallelism": user.kdf_parallelism,
        },
        "wrapped_vault_key": user.wrapped_vault_key,
        "public_key": user.public_key,
        "wrapped_private_key": user.wrapped_private_key,
        "policy": get_policy(db),
        "mail_enabled": ctx.mailer.enabled,
        "session": {
            "id": auth.session.id,
            "expires_at": auth.session.expires_at,
            "idle_minutes": ctx.settings.session_idle_minutes,
        },
    }


def apply_password(user: User, material) -> None:
    user.kdf_salt = material.kdf.salt
    user.kdf_time_cost = material.kdf.time_cost
    user.kdf_memory_kib = material.kdf.memory_kib
    user.kdf_parallelism = material.kdf.parallelism
    user.auth_hash = hash_secret(material.auth_key)
    user.wrapped_vault_key = material.wrapped_vault_key
    user.password_changed_at = utcnow()


def apply_recovery(user: User, material) -> None:
    user.recovery_auth_hash = hash_secret(material.recovery_auth_key)
    user.recovery_wrapped_vault_key = material.recovery_wrapped_vault_key
