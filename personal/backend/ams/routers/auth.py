from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete
from sqlalchemy.orm import Session as DbSession

from ..core import (
    AppContext,
    Auth,
    apply_password,
    apply_recovery,
    clear_session_cookie,
    current_auth,
    enforce_limit,
    get_ctx,
    get_db,
    get_owner,
    get_preferences,
    kdf_of,
    record,
    session_payload,
    start_session,
)
from ..models import Session, User
from ..schemas import LoginIn, RecoverFinishIn, RecoverStartIn, SetupIn
from ..security import verify_secret

router = APIRouter(prefix="/api/auth", tags=["auth"])

_setup_lock = threading.Lock()


@router.get("/status")
def status(db: DbSession = Depends(get_db)):
    owner = get_owner(db)
    return {
        "setup_required": owner is None,
        "policy": get_preferences(db),
        "kdf": kdf_of(owner) if owner else None,
        "name": owner.name if owner else None,
    }


@router.post("/setup", status_code=201)
def setup(body: SetupIn, db: DbSession = Depends(get_db)):
    with _setup_lock:
        if get_owner(db) is not None:
            raise HTTPException(status_code=409, detail="This vault has already been set up")
        owner = User(name=body.name)
        apply_password(owner, body)
        apply_recovery(owner, body)
        db.add(owner)
        record(db, "vault.created")
        db.commit()
    return {"ok": True}


def _owner_or_404(db: DbSession) -> User:
    owner = get_owner(db)
    if owner is None:
        raise HTTPException(status_code=409, detail="This vault has not been set up yet")
    return owner


@router.post("/login")
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    owner = _owner_or_404(db)
    enforce_limit(ctx.limits.login)
    if not verify_secret(owner.auth_hash, body.auth_key):
        ctx.limits.login.hit("local")
        record(db, "unlock.failed")
        db.commit()
        raise HTTPException(status_code=401, detail="Incorrect master password")

    ctx.limits.login.reset("local")
    session = start_session(db, request, response, owner)
    record(db, "unlock.ok")
    db.commit()
    return session_payload(ctx, db, Auth(user=owner, session=session))


@router.get("/session")
def get_session(auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    return session_payload(ctx, db, auth)


@router.post("/logout")
def logout(response: Response, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    db.delete(auth.session)
    db.commit()
    clear_session_cookie(response)
    return {"ok": True}


def _verify_recovery(ctx: AppContext, db: DbSession, recovery_auth_key: str) -> User:
    owner = _owner_or_404(db)
    enforce_limit(ctx.limits.recover)
    if not verify_secret(owner.recovery_auth_hash, recovery_auth_key):
        ctx.limits.recover.hit("local")
        record(db, "recovery.failed")
        db.commit()
        raise HTTPException(status_code=401, detail="Incorrect recovery code")
    return owner


@router.post("/recover/start")
def recover_start(body: RecoverStartIn, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    owner = _verify_recovery(ctx, db, body.recovery_auth_key)
    return {"recovery_wrapped_vault_key": owner.recovery_wrapped_vault_key, "policy": get_preferences(db)}


@router.post("/recover/finish")
def recover_finish(body: RecoverFinishIn, db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    owner = _verify_recovery(ctx, db, body.recovery_auth_key)
    apply_password(owner, body)
    apply_recovery(owner, body.new_recovery)
    db.execute(delete(Session))
    ctx.limits.login.reset("local")
    ctx.limits.recover.reset("local")
    record(db, "recovery.ok")
    db.commit()
    return {"ok": True}
