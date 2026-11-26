from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from ..core import (
    AppContext,
    Auth,
    apply_password,
    apply_recovery,
    clear_session_cookie,
    current_auth,
    get_ctx,
    get_db,
    record,
    require_reauth,
    save_preferences,
)
from ..models import Activity, Session, Setting, User
from ..schemas import ChangePasswordIn, ChangeRecoveryIn, PreferencesIn, ProfileIn, ReauthIn

router = APIRouter(prefix="/api/account", tags=["account"])


@router.patch("/profile")
def update_profile(body: ProfileIn, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    auth.user.name = body.name
    db.commit()
    return {"name": auth.user.name}


@router.put("/password")
def change_password(
    body: ChangePasswordIn,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    apply_password(user, body)
    db.execute(delete(Session).where(Session.id != auth.session.id))
    record(db, "password.changed")
    db.commit()
    return {"ok": True}


@router.put("/recovery")
def change_recovery_code(
    body: ChangeRecoveryIn,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    user = auth.user
    require_reauth(ctx, user, body.current_auth_key)
    apply_recovery(user, body)
    record(db, "recovery_code.replaced")
    db.commit()
    return {"ok": True}


@router.put("/preferences")
def update_preferences(body: PreferencesIn, _: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    preferences = save_preferences(db, body.model_dump(exclude_none=True))
    db.commit()
    return preferences


@router.get("/activity")
def activity(
    limit: int = Query(default=20, ge=1, le=100),
    _: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
):
    rows = db.scalars(select(Activity).order_by(Activity.at.desc(), Activity.id.desc()).limit(limit)).all()
    return [{"id": r.id, "at": r.at, "action": r.action} for r in rows]


@router.post("/delete")
def delete_vault(
    body: ReauthIn,
    response: Response,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    require_reauth(ctx, auth.user, body.current_auth_key)
    db.delete(db.get(User, auth.user.id))
    db.execute(delete(Activity))
    db.execute(delete(Setting))
    db.commit()
    clear_session_cookie(response)
    return {"ok": True}
