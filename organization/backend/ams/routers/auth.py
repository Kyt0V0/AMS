from __future__ import annotations

import os
import threading

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..core import (
    AppContext,
    Auth,
    apply_password,
    apply_recovery,
    audit,
    clear_session_cookie,
    client_ip,
    current_auth,
    enforce_limit,
    get_ctx,
    get_db,
    get_policy,
    revoke_sessions,
    session_payload,
    start_session,
)
from .. import codes
from ..db import utcnow
from ..models import Invite, User
from ..schemas import (
    LoginIn,
    LoginVerifyIn,
    PreloginIn,
    RecoverFinishIn,
    RecoverStartIn,
    RegisterIn,
    TicketIn,
    TokenIn,
)
from ..security import hash_token, is_valid_public_key, new_token, tokens_equal, verify_secret

router = APIRouter(prefix="/api/auth", tags=["auth"])

_setup_lock = threading.Lock()
_BAD_LOGIN = "Incorrect username or password"
_BAD_RECOVERY = "Incorrect username or recovery code"


def _setup_token_path(ctx: AppContext):
    return ctx.settings.data_dir / "setup-token.txt"


def ensure_setup_token(ctx: AppContext) -> str | None:
    with ctx.session_factory() as db:
        if db.scalar(select(func.count()).select_from(User)):
            _setup_token_path(ctx).unlink(missing_ok=True)
            return None
    path = _setup_token_path(ctx)
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    token = new_token(24)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(token + "\n")
    return token


def _user_count(db: DbSession) -> int:
    return db.scalar(select(func.count()).select_from(User))


def _find_invite(db: DbSession, token: str) -> Invite | None:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(token)))
    if invite is None or invite.used_at is not None or invite.expires_at <= utcnow():
        return None
    return invite


def _add_user(ctx: AppContext, db: DbSession, body: RegisterIn, role: str) -> User:
    if not is_valid_public_key(body.public_key):
        raise HTTPException(status_code=422, detail="Invalid public key")
    user = User(
        username_lookup=ctx.keys.lookup(body.username),
        username_enc=ctx.keys.encrypt(body.username),
        email_lookup=ctx.keys.lookup(body.email),
        email_enc=ctx.keys.encrypt(body.email),
        role=role,
        public_key=body.public_key,
        wrapped_private_key=body.wrapped_private_key,
    )
    apply_password(user, body)
    apply_recovery(user, body)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email is already in use") from None
    return user


@router.get("/status")
def status(db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    policy = get_policy(db)
    return {"setup_required": _user_count(db) == 0, "policy": policy, "mail_enabled": ctx.mailer.enabled}


def _finish_login(db: DbSession, request: Request, response: Response, ctx: AppContext, user: User):
    session = start_session(db, request, response, user)
    user.last_login_at = utcnow()
    audit(db, request, "auth.login", actor_id=user.id)
    db.commit()
    return session_payload(ctx, db, Auth(user=user, session=session))


_LOCAL_ADDRESSES = {"127.0.0.1", "::1"}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
_PROXY_HEADERS = ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip")


def _is_on_server_machine(request: Request, ctx: AppContext) -> bool:
    if ctx.settings.behind_proxy or any(header in request.headers for header in _PROXY_HEADERS):
        return False
    peer = request.client.host if request.client else ""
    host = request.headers.get("host", "").lower()
    hostname = host.rsplit(":", 1)[0] if not host.endswith("]") else host
    return peer in _LOCAL_ADDRESSES and hostname in _LOCAL_HOSTS


@router.get("/setup-token")
def local_setup_token(request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    path = _setup_token_path(ctx)
    if not _is_on_server_machine(request, ctx) or _user_count(db) > 0 or not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return {"token": path.read_text(encoding="utf-8").strip()}


@router.post("/setup", status_code=201)
def setup(body: RegisterIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    ip = client_ip(request)
    enforce_limit(ctx.limits.signup_ip, ip)
    with _setup_lock:
        if _user_count(db) > 0:
            raise HTTPException(status_code=409, detail="Setup has already been completed")
        path = _setup_token_path(ctx)
        expected = path.read_text(encoding="utf-8").strip() if path.exists() else ""
        if not expected or not body.setup_token or not tokens_equal(body.setup_token, expected):
            ctx.limits.signup_ip.hit(ip)
            raise HTTPException(status_code=403, detail="Invalid setup token")

        user = _add_user(ctx, db, body, role="admin")
        audit(db, request, "auth.setup", actor_id=user.id, target=user.id)
        db.commit()
        path.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/invite/check")
def check_invite(body: TokenIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    ip = client_ip(request)
    enforce_limit(ctx.limits.signup_ip, ip)
    invite = _find_invite(db, body.token)
    if invite is None:
        ctx.limits.signup_ip.hit(ip)
        raise HTTPException(status_code=404, detail="This invitation is invalid or has expired")
    return {"role": invite.role, "expires_at": invite.expires_at}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    ip = client_ip(request)
    enforce_limit(ctx.limits.signup_ip, ip)
    if _user_count(db) == 0:
        raise HTTPException(status_code=409, detail="The system has not been set up yet")

    invite = None
    if body.invite_token:
        invite = _find_invite(db, body.invite_token)
        if invite is None:
            ctx.limits.signup_ip.hit(ip)
            raise HTTPException(status_code=403, detail="This invitation is invalid or has expired")
    elif not get_policy(db)["open_registration"]:
        raise HTTPException(status_code=403, detail="An invitation is required to create an account")
    else:
        ctx.limits.signup_ip.hit(ip)

    user = _add_user(ctx, db, body, role=invite.role if invite else "editor")
    if invite:
        invite.used_at = utcnow()
        invite.used_by = user.id
    audit(db, request, "auth.register", actor_id=user.id, target=user.id, detail=f"role={user.role}")
    db.commit()
    return {"ok": True}


@router.post("/prelogin")
def prelogin(body: PreloginIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    ip = client_ip(request)
    enforce_limit(ctx.limits.prelogin_ip, ip)
    ctx.limits.prelogin_ip.hit(ip)

    user = db.scalar(select(User).where(User.username_lookup == ctx.keys.lookup(body.username)))
    if user:
        return {
            "salt": user.kdf_salt,
            "time_cost": user.kdf_time_cost,
            "memory_kib": user.kdf_memory_kib,
            "parallelism": user.kdf_parallelism,
        }
    policy = get_policy(db)
    return {
        "salt": ctx.keys.decoy_salt(body.username),
        "time_cost": policy["kdf_time_cost"],
        "memory_kib": policy["kdf_memory_kib"],
        "parallelism": policy["kdf_parallelism"],
    }


@router.post("/login")
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    ip = client_ip(request)
    name_key = ctx.keys.lookup(body.username)
    enforce_limit(ctx.limits.login_ip, ip)
    enforce_limit(ctx.limits.login_user, name_key)

    user = db.scalar(select(User).where(User.username_lookup == name_key))
    if not verify_secret(user.auth_hash if user else None, body.auth_key):
        ctx.limits.login_ip.hit(ip)
        ctx.limits.login_user.hit(name_key)
        audit(db, request, "auth.login_failed", actor_id=user.id if user else None)
        db.commit()
        raise HTTPException(status_code=401, detail=_BAD_LOGIN)
    if not user.is_active:
        audit(db, request, "auth.login_blocked", actor_id=user.id, detail="account disabled")
        db.commit()
        raise HTTPException(status_code=403, detail="This account has been disabled. Contact an administrator.")

    if codes.two_factor_required(db, user):
        enforce_limit(ctx.limits.code_user, user.id)
        ticket, hint = codes.issue(ctx, db, user, codes.LOGIN)
        audit(db, request, "auth.code_sent", actor_id=user.id)
        db.commit()
        return {"two_factor_required": True, "ticket": ticket, "email_hint": hint}

    ctx.limits.login_user.reset(name_key)
    return _finish_login(db, request, response, ctx, user)


@router.post("/login/verify")
def login_verify(
    body: LoginVerifyIn,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    ip = client_ip(request)
    enforce_limit(ctx.limits.login_ip, ip)
    row = codes.find(db, codes.LOGIN, ticket=body.ticket)
    user = db.get(User, row.user_id) if row else None
    if user is not None:
        enforce_limit(ctx.limits.login_user, user.username_lookup)
        enforce_limit(ctx.limits.code_user, user.id)
    try:
        codes.redeem(db, row, body.code)
    except HTTPException:
        ctx.limits.login_ip.hit(ip)
        if user is not None:
            ctx.limits.login_user.hit(user.username_lookup)
            ctx.limits.code_user.hit(user.id)
            audit(db, request, "auth.code_failed", actor_id=user.id)
            db.commit()
        raise
    if user is None or not user.is_active:
        db.commit()
        raise HTTPException(status_code=401, detail=_BAD_LOGIN)
    ctx.limits.login_user.reset(user.username_lookup)
    ctx.limits.code_user.reset(user.id)
    return _finish_login(db, request, response, ctx, user)


@router.post("/login/resend")
def login_resend(body: TicketIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    enforce_limit(ctx.limits.login_ip, client_ip(request))
    row = codes.find(db, codes.LOGIN, ticket=body.ticket)
    user = db.get(User, row.user_id) if row else None
    if user is None or not user.is_active:
        ctx.limits.login_ip.hit(client_ip(request))
        raise HTTPException(status_code=401, detail="This sign-in has expired. Start again.")
    enforce_limit(ctx.limits.code_user, user.id)
    ticket, hint = codes.issue(ctx, db, user, codes.LOGIN)
    db.commit()
    return {"two_factor_required": True, "ticket": ticket, "email_hint": hint}


@router.get("/session")
def get_session(auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    return session_payload(ctx, db, auth)


@router.post("/logout")
def logout(request: Request, response: Response, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    db.delete(auth.session)
    audit(db, request, "auth.logout", actor_id=auth.user.id)
    db.commit()
    clear_session_cookie(request, response)
    return {"ok": True}


def _verify_recovery(ctx: AppContext, db: DbSession, request: Request, username: str, recovery_auth_key: str) -> User:
    ip = client_ip(request)
    name_key = ctx.keys.lookup(username)
    enforce_limit(ctx.limits.recover_ip, ip)
    enforce_limit(ctx.limits.recover_user, name_key)

    user = db.scalar(select(User).where(User.username_lookup == name_key))
    if not verify_secret(user.recovery_auth_hash if user else None, recovery_auth_key) or not user.is_active:
        ctx.limits.recover_ip.hit(ip)
        ctx.limits.recover_user.hit(name_key)
        audit(db, request, "auth.recovery_failed", actor_id=user.id if user else None)
        db.commit()
        raise HTTPException(status_code=401, detail=_BAD_RECOVERY)
    return user


@router.post("/recover/start")
def recover_start(
    body: RecoverStartIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)
):
    user = _verify_recovery(ctx, db, request, body.username, body.recovery_auth_key)
    policy = get_policy(db)
    return {"recovery_wrapped_vault_key": user.recovery_wrapped_vault_key, "policy": policy}


@router.post("/recover/finish")
def recover_finish(
    body: RecoverFinishIn, request: Request, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)
):
    user = _verify_recovery(ctx, db, request, body.username, body.recovery_auth_key)
    apply_password(user, body)
    apply_recovery(user, body.new_recovery)
    revoke_sessions(db, user.id)
    ctx.limits.login_user.reset(user.username_lookup)
    ctx.limits.recover_user.reset(user.username_lookup)
    ctx.limits.code_user.reset(user.id)
    audit(db, request, "auth.recovered", actor_id=user.id)
    db.commit()
    return {"ok": True}
