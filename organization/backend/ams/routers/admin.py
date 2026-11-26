from __future__ import annotations

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..core import (
    AppContext,
    Auth,
    audit,
    get_ctx,
    get_db,
    other_active_admins,
    require_admin,
    revoke_sessions,
    save_policy,
    get_policy,
)
from ..db import utcnow
from ..models import AuditLog, Credential, Invite, Session, Share, User
from ..schemas import AdminUserIn, InviteIn, PolicyIn
from ..security import hash_token, new_token

router = APIRouter(prefix="/api/admin", tags=["admin"])

_DETAIL_USER = re.compile(r"\b(to|from)=([0-9a-f-]{36})")


def _count(db: DbSession, model, *where) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where))


def _target_user(db: DbSession, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/overview")
def overview(_: Auth = Depends(require_admin), db: DbSession = Depends(get_db)):
    now = utcnow()
    return {
        "users": _count(db, User),
        "active_users": _count(db, User, User.is_active),
        "admins": _count(db, User, User.role == "admin", User.is_active),
        "entries": _count(db, Credential),
        "shares": _count(db, Share),
        "sessions": _count(db, Session, Session.expires_at > now),
        "pending_invites": _count(db, Invite, Invite.used_at.is_(None), Invite.expires_at > now),
        "failed_logins_24h": _count(
            db, AuditLog, AuditLog.action == "auth.login_failed", AuditLog.at > now - timedelta(hours=24)
        ),
    }


@router.get("/users")
def list_users(_: Auth = Depends(require_admin), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)):
    entry_counts = dict(db.execute(select(Credential.owner_id, func.count()).group_by(Credential.owner_id)).all())
    users = db.scalars(select(User).order_by(User.created_at)).all()
    return [
        {
            "id": u.id,
            "username": ctx.keys.decrypt(u.username_enc),
            "email": ctx.keys.decrypt(u.email_enc),
            "role": u.role,
            "is_active": u.is_active,
            "can_share": u.can_share,
            "can_edit_profile": u.can_edit_profile,
            "two_factor_enabled": u.two_factor_enabled,
            "entries": entry_counts.get(u.id, 0),
            "created_at": u.created_at,
            "last_login_at": u.last_login_at,
        }
        for u in users
    ]


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    body: AdminUserIn,
    request: Request,
    auth: Auth = Depends(require_admin),
    db: DbSession = Depends(get_db),
):
    user = _target_user(db, user_id)
    changes = body.model_dump(exclude_none=True)
    loses_admin = user.role == "admin" and (
        changes.get("role", "admin") != "admin" or changes.get("is_active", True) is False
    )
    if loses_admin:
        if user.id == auth.user.id:
            raise HTTPException(status_code=409, detail="You cannot remove your own administrator access")
        if user.is_active and other_active_admins(db, user.id) == 0:
            raise HTTPException(status_code=409, detail="At least one active administrator is required")

    for name, value in changes.items():
        setattr(user, name, value)
    if changes.get("is_active") is False:
        revoke_sessions(db, user.id)
    detail = ",".join(f"{k}={v}" for k, v in sorted(changes.items()))
    audit(db, request, "admin.user_updated", actor_id=auth.user.id, target=user.id, detail=detail)
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/revoke-sessions")
def revoke_user_sessions(
    user_id: str, request: Request, auth: Auth = Depends(require_admin), db: DbSession = Depends(get_db)
):
    user = _target_user(db, user_id)
    keep = auth.session.id if user.id == auth.user.id else None
    count = revoke_sessions(db, user.id, keep_session_id=keep)
    audit(db, request, "admin.sessions_revoked", actor_id=auth.user.id, target=user.id, detail=f"count={count}")
    db.commit()
    return {"revoked": count}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, request: Request, auth: Auth = Depends(require_admin), db: DbSession = Depends(get_db)):
    user = _target_user(db, user_id)
    if user.id == auth.user.id:
        raise HTTPException(status_code=409, detail="Delete your own account from Settings instead")
    if user.role == "admin" and user.is_active and other_active_admins(db, user.id) == 0:
        raise HTTPException(status_code=409, detail="At least one active administrator is required")
    audit(db, request, "admin.user_deleted", actor_id=auth.user.id, target=user.id)
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.get("/invites")
def list_invites(_: Auth = Depends(require_admin), db: DbSession = Depends(get_db)):
    now = utcnow()
    rows = db.scalars(select(Invite).order_by(Invite.created_at.desc()).limit(200)).all()
    return [
        {
            "id": i.id,
            "label": i.label,
            "role": i.role,
            "created_at": i.created_at,
            "expires_at": i.expires_at,
            "status": "used" if i.used_at else ("expired" if i.expires_at <= now else "pending"),
        }
        for i in rows
    ]


@router.post("/invites", status_code=201)
def create_invite(
    body: InviteIn, request: Request, auth: Auth = Depends(require_admin), db: DbSession = Depends(get_db)
):
    token = new_token(24)
    invite = Invite(
        token_hash=hash_token(token),
        label=body.label,
        role=body.role,
        created_by=auth.user.id,
        expires_at=utcnow() + timedelta(days=body.expires_in_days),
    )
    db.add(invite)
    db.flush()
    audit(db, request, "admin.invite_created", actor_id=auth.user.id, target=invite.id, detail=f"role={body.role}")
    db.commit()
    return {"id": invite.id, "token": token, "role": invite.role, "expires_at": invite.expires_at}


@router.delete("/invites/{invite_id}")
def revoke_invite(
    invite_id: str, request: Request, auth: Auth = Depends(require_admin), db: DbSession = Depends(get_db)
):
    invite = db.get(Invite, invite_id)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    db.delete(invite)
    audit(db, request, "admin.invite_revoked", actor_id=auth.user.id, target=invite_id)
    db.commit()
    return {"ok": True}


@router.get("/policy")
def read_policy(_: Auth = Depends(require_admin), db: DbSession = Depends(get_db)):
    return get_policy(db)


@router.put("/policy")
def update_policy(
    body: PolicyIn,
    request: Request,
    auth: Auth = Depends(require_admin),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    changes = body.model_dump(exclude_none=True)
    if changes.get("require_two_factor") and not get_policy(db)["require_two_factor"]:
        if not ctx.mailer.enabled:
            raise HTTPException(status_code=409, detail="Set up e-mail on the server before requiring two-step sign-in")
        if not auth.user.two_factor_enabled:
            raise HTTPException(status_code=409, detail="Turn on two-step sign-in for your own account first")
    policy = save_policy(db, changes)
    detail = ",".join(f"{k}={v}" for k, v in sorted(changes.items()))
    audit(db, request, "admin.policy_updated", actor_id=auth.user.id, detail=detail)
    db.commit()
    return policy


@router.get("/audit")
def audit_trail(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None, max_length=48),
    actor_id: str | None = Query(default=None, max_length=36),
    _: Auth = Depends(require_admin),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    where = []
    if action:
        where.append(AuditLog.action.startswith(action, autoescape=True))
    if actor_id:
        where.append(AuditLog.actor_id == actor_id)

    total = _count(db, AuditLog, *where)
    rows = db.scalars(
        select(AuditLog).where(*where).order_by(AuditLog.at.desc(), AuditLog.id.desc()).offset(offset).limit(limit)
    ).all()

    ids = {r.actor_id for r in rows if r.actor_id}
    for row in rows:
        ids.update(match.group(2) for match in _DETAIL_USER.finditer(row.detail or ""))
    names = {
        uid: ctx.keys.decrypt(name_enc)
        for uid, name_enc in db.execute(select(User.id, User.username_enc).where(User.id.in_(ids))).all()
    }

    def readable(detail: str | None) -> str | None:
        if not detail:
            return detail
        return _DETAIL_USER.sub(lambda m: f"{m.group(1)}={names.get(m.group(2), 'deleted user')}", detail)

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "at": r.at,
                "actor_id": r.actor_id,
                "actor": names.get(r.actor_id) if r.actor_id else None,
                "action": r.action,
                "target": r.target,
                "detail": readable(r.detail),
                "ip": r.ip,
            }
            for r in rows
        ],
    }
