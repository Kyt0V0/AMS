from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Iterator

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .db import utcnow
from .models import Activity, Session, Setting, User
from .ratelimit import Limits, RateLimiter
from .security import hash_secret, hash_token, new_token, verify_secret

COOKIE = "ams_personal_session"

DEFAULT_PREFERENCES: dict[str, Any] = {
    "kdf_time_cost": 3,
    "kdf_memory_kib": 65536,
    "kdf_parallelism": 1,
    "min_password_length": 12,
    "password_max_age_days": 180,
    "vault_timeout_minutes": 10,
}


@dataclass
class AppContext:
    settings: Settings
    session_factory: sessionmaker
    limits: Limits = field(default_factory=Limits)


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def get_db(request: Request) -> Iterator[DbSession]:
    db = request.app.state.ctx.session_factory()
    try:
        yield db
    finally:
        db.close()


def enforce_limit(limiter: RateLimiter, key: str = "local") -> None:
    wait = limiter.retry_after(key)
    if wait:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait and try again.",
            headers={"Retry-After": str(wait)},
        )


ACTIVITY_KEPT = 500


def record(db: DbSession, action: str) -> None:
    row = Activity(action=action)
    db.add(row)
    db.flush()
    db.execute(delete(Activity).where(Activity.id <= row.id - ACTIVITY_KEPT))


def get_preferences(db: DbSession) -> dict[str, Any]:
    preferences = dict(DEFAULT_PREFERENCES)
    row = db.get(Setting, "preferences")
    if row:
        preferences.update({k: v for k, v in json.loads(row.value).items() if k in DEFAULT_PREFERENCES})
    return preferences


def save_preferences(db: DbSession, updates: dict[str, Any]) -> dict[str, Any]:
    preferences = get_preferences(db)
    preferences.update(updates)
    row = db.get(Setting, "preferences")
    if row:
        row.value = json.dumps(preferences)
    else:
        db.add(Setting(key="preferences", value=json.dumps(preferences)))
    return preferences


def get_owner(db: DbSession) -> User | None:
    return db.scalar(select(User).limit(1))


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
    )
    db.add(session)
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/")
    return session


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")


@dataclass
class Auth:
    user: User
    session: Session


def current_auth(request: Request, db: DbSession = Depends(get_db)) -> Auth:
    ctx: AppContext = request.app.state.ctx
    token = request.cookies.get(COOKIE)
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
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    if now - session.last_seen_at > timedelta(seconds=60):
        session.last_seen_at = now
        db.commit()
    return Auth(user=user, session=session)


def require_reauth(ctx: AppContext, user: User, auth_key: str) -> None:
    enforce_limit(ctx.limits.login)
    if not verify_secret(user.auth_hash, auth_key):
        ctx.limits.login.hit("local")
        raise HTTPException(status_code=403, detail="Current password is incorrect")


def kdf_of(user: User) -> dict[str, Any]:
    return {
        "salt": user.kdf_salt,
        "time_cost": user.kdf_time_cost,
        "memory_kib": user.kdf_memory_kib,
        "parallelism": user.kdf_parallelism,
    }


def session_payload(ctx: AppContext, db: DbSession, auth: Auth) -> dict[str, Any]:
    user = auth.user
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "created_at": user.created_at,
            "password_changed_at": user.password_changed_at,
        },
        "kdf": kdf_of(user),
        "wrapped_vault_key": user.wrapped_vault_key,
        "policy": get_preferences(db),
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
