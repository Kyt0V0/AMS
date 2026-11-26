from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..core import (
    AppContext,
    Auth,
    apply_password,
    apply_recovery,
    audit,
    clear_session_cookie,
    current_auth,
    get_ctx,
    get_db,
    other_active_admins,
    require_reauth,
    revoke_sessions,
)
from .. import codes
from ..mail import MailError
from ..models import Session, User
from ..schemas import ChangePasswordIn, ChangeRecoveryIn, CodeIn, EmailChangeIn, ProfileIn, ReauthIn

router = APIRouter(prefix="/api/account", tags=["account"])


@router.patch("/profile")
def update_profile(
    body: ProfileIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    changed: list[str] = []

    if body.username is not None or body.email is not None:
        _may_edit_profile(user)
    if body.username is not None and body.username != ctx.keys.decrypt(user.username_enc):
        user.username_lookup = ctx.keys.lookup(body.username)
        user.username_enc = ctx.keys.encrypt(body.username)
        changed.append("username")
    if body.email is not None and body.email != ctx.keys.decrypt(user.email_enc):
        if ctx.mailer.enabled:
            raise HTTPException(status_code=409, detail="Confirm the new e-mail address with a verification code")
        if body.current_auth_key is None:
            raise HTTPException(status_code=403, detail="Enter your master password to change the e-mail address")
        require_reauth(ctx, user, body.current_auth_key)
        user.email_lookup = ctx.keys.lookup(body.email)
        user.email_enc = ctx.keys.encrypt(body.email)
        changed.append("email")
    if body.preferred_language is not None:
        user.preferred_language = body.preferred_language

    if changed:
        audit(db, request, "account.profile_updated", actor_id=user.id, detail=",".join(changed))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email is already in use") from None
    return {
        "username": ctx.keys.decrypt(user.username_enc),
        "email": ctx.keys.decrypt(user.email_enc),
        "preferred_language": user.preferred_language,
    }


def _may_edit_profile(user: User) -> None:
    if not user.can_edit_profile and user.role != "admin":
        raise HTTPException(status_code=403, detail="An administrator has locked your profile details")


@router.post("/email/start")
def start_email_change(
    body: EmailChangeIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    _may_edit_profile(user)
    taken = db.scalar(select(User.id).where(User.email_lookup == ctx.keys.lookup(body.email), User.id != user.id))
    if taken:
        raise HTTPException(status_code=409, detail="That username or email is already in use")
    require_reauth(ctx, user, body.current_auth_key)
    _, hint = codes.issue(ctx, db, user, codes.EMAIL_CHANGE, new_email=body.email)
    db.commit()
    return {"email_hint": hint}


@router.post("/email/confirm")
def confirm_email_change(
    body: CodeIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    _may_edit_profile(user)
    row = codes.redeem(db, codes.find(db, codes.EMAIL_CHANGE, user_id=user.id), body.code)
    email = ctx.keys.decrypt(row.target_enc)
    previous = ctx.keys.decrypt(user.email_enc)
    user.email_lookup = ctx.keys.lookup(email)
    user.email_enc = ctx.keys.encrypt(email)
    audit(db, request, "account.profile_updated", actor_id=user.id, detail="email")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email is already in use") from None
    try:
        ctx.mailer.send(
            previous,
            "Your AMS e-mail address was changed",
            f"The e-mail address of your AMS account was changed to {codes.mask_email(email)}.\n\n"
            "Sign-in codes now go to the new address. If you did not make this change, "
            "contact an administrator and change your master password.\n",
        )
    except MailError:
        pass
    return {"email": email}


@router.post("/two-factor/start")
def start_two_factor(auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    _, hint = codes.issue(ctx, db, auth.user, codes.ENABLE)
    db.commit()
    return {"email_hint": hint}


@router.post("/two-factor/enable")
def enable_two_factor(
    body: CodeIn, request: Request, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)
):
    user = auth.user
    codes.redeem(db, codes.find(db, codes.ENABLE, user_id=user.id), body.code)
    user.two_factor_enabled = True
    audit(db, request, "account.two_factor_enabled", actor_id=user.id)
    db.commit()
    return {"two_factor_enabled": True}


@router.post("/two-factor/disable")
def disable_two_factor(
    body: ReauthIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    user.two_factor_enabled = False
    audit(db, request, "account.two_factor_disabled", actor_id=user.id)
    db.commit()
    return {"two_factor_enabled": False}


@router.put("/password")
def change_password(
    body: ChangePasswordIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    apply_password(user, body)
    revoked = revoke_sessions(db, user.id, keep_session_id=auth.session.id)
    audit(db, request, "account.password_changed", actor_id=user.id, detail=f"other_sessions_revoked={revoked}")
    db.commit()
    return {"ok": True}


@router.put("/recovery")
def change_recovery_code(
    body: ChangeRecoveryIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    apply_recovery(user, body)
    audit(db, request, "account.recovery_code_replaced", actor_id=user.id)
    db.commit()
    return {"ok": True}


@router.get("/sessions")
def list_sessions(auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    rows = db.scalars(
        select(Session).where(Session.user_id == auth.user.id).order_by(Session.last_seen_at.desc())
    ).all()
    return [
        {
            "id": s.id,
            "current": s.id == auth.session.id,
            "ip": s.ip,
            "user_agent": s.user_agent,
            "created_at": s.created_at,
            "last_seen_at": s.last_seen_at,
        }
        for s in rows
    ]


@router.post("/sessions/revoke-others")
def revoke_other_sessions(request: Request, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    count = revoke_sessions(db, auth.user.id, keep_session_id=auth.session.id)
    audit(db, request, "account.sessions_revoked", actor_id=auth.user.id, detail=f"count={count}")
    db.commit()
    return {"revoked": count}


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: str, request: Request, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)
):
    session = db.get(Session, session_id)
    if session is None or session.user_id != auth.user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    audit(db, request, "account.sessions_revoked", actor_id=auth.user.id, detail="count=1")
    db.commit()
    return {"ok": True}


@router.post("/delete")
def delete_account(
    body: ReauthIn,
    request: Request,
    response: Response,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    if user.role == "admin" and other_active_admins(db, user.id) == 0:
        raise HTTPException(status_code=409, detail="You are the only administrator. Promote someone else first.")
    audit(db, request, "account.deleted", actor_id=user.id, target=user.id)
    db.delete(db.get(User, user.id))
    db.commit()
    clear_session_cookie(request, response)
    return {"ok": True}
