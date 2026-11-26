from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..core import AppContext, Auth, audit, current_auth, get_ctx, get_db, require_editor
from ..db import utcnow
from ..models import Credential, Share, User
from ..schemas import CredentialCreateIn, CredentialRotateIn, CredentialUpdateIn, ShareIn

router = APIRouter(prefix="/api", tags=["vault"])

_STALE = "This entry was changed somewhere else. Reload and try again."


def _owned(db: DbSession, credential_id: str, user: User) -> Credential:
    credential = db.get(Credential, credential_id)
    if credential is None or credential.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found")
    return credential


def _bump(db: DbSession, credential_id: str, expected_version: int, **values) -> int:
    result = db.execute(
        update(Credential)
        .where(Credential.id == credential_id, Credential.version == expected_version)
        .values(version=expected_version + 1, updated_at=utcnow(), **values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail=_STALE)
    return expected_version + 1


def _credential_out(c: Credential, *, owner_name: str, is_owner: bool, wrapped_key: str, owner_public_key, shared_with):
    return {
        "id": c.id,
        "owner_id": c.owner_id,
        "owner_username": owner_name,
        "is_owner": is_owner,
        "ciphertext": c.ciphertext,
        "wrapped_key": wrapped_key,
        "owner_public_key": owner_public_key,
        "shared_with": shared_with,
        "version": c.version,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
        "key_rotated_at": c.key_rotated_at,
    }


@router.get("/users")
def user_directory(
    auth: Auth = Depends(require_editor), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)
):
    rows = db.execute(
        select(User.id, User.username_enc, User.public_key).where(User.is_active, User.id != auth.user.id).limit(2000)
    ).all()
    people = [{"id": r.id, "username": ctx.keys.decrypt(r.username_enc), "public_key": r.public_key} for r in rows]
    return sorted(people, key=lambda p: p["username"].casefold())


@router.get("/credentials")
def list_credentials(
    auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db), ctx: AppContext = Depends(get_ctx)
):
    user = auth.user
    my_name = ctx.keys.decrypt(user.username_enc)

    share_counts = dict(
        db.execute(
            select(Share.credential_id, func.count())
            .join(Credential, Credential.id == Share.credential_id)
            .where(Credential.owner_id == user.id)
            .group_by(Share.credential_id)
        ).all()
    )
    owned = db.scalars(select(Credential).where(Credential.owner_id == user.id)).all()
    out = [
        _credential_out(
            c,
            owner_name=my_name,
            is_owner=True,
            wrapped_key=c.wrapped_key,
            owner_public_key=None,
            shared_with=share_counts.get(c.id, 0),
        )
        for c in owned
    ]

    shared = db.execute(
        select(Credential, Share.wrapped_key, User.username_enc, User.public_key)
        .join(Share, Share.credential_id == Credential.id)
        .join(User, User.id == Credential.owner_id)
        .where(Share.recipient_id == user.id)
    ).all()
    out += [
        _credential_out(
            c,
            owner_name=ctx.keys.decrypt(owner_name_enc),
            is_owner=False,
            wrapped_key=wrapped_key,
            owner_public_key=owner_public_key,
            shared_with=0,
        )
        for c, wrapped_key, owner_name_enc, owner_public_key in shared
    ]
    return out


@router.post("/credentials", status_code=201)
def create_credential(
    body: CredentialCreateIn, request: Request, auth: Auth = Depends(require_editor), db: DbSession = Depends(get_db)
):
    credential = Credential(
        id=str(body.id), owner_id=auth.user.id, ciphertext=body.ciphertext, wrapped_key=body.wrapped_key
    )
    db.add(credential)
    audit(db, request, "credential.created", actor_id=auth.user.id, target=credential.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An entry with this id already exists") from None
    return {"id": credential.id, "version": credential.version}


@router.put("/credentials/{credential_id}")
def update_credential(
    credential_id: str,
    body: CredentialUpdateIn,
    request: Request,
    auth: Auth = Depends(require_editor),
    db: DbSession = Depends(get_db),
):
    _owned(db, credential_id, auth.user)
    version = _bump(db, credential_id, body.version, ciphertext=body.ciphertext)
    audit(db, request, "credential.updated", actor_id=auth.user.id, target=credential_id)
    db.commit()
    return {"version": version}


@router.delete("/credentials/{credential_id}")
def delete_credential(
    credential_id: str, request: Request, auth: Auth = Depends(require_editor), db: DbSession = Depends(get_db)
):
    credential = _owned(db, credential_id, auth.user)
    db.delete(credential)
    audit(db, request, "credential.deleted", actor_id=auth.user.id, target=credential_id)
    db.commit()
    return {"ok": True}


@router.get("/credentials/{credential_id}/shares")
def list_shares(
    credential_id: str,
    auth: Auth = Depends(current_auth),
    db: DbSession = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
):
    _owned(db, credential_id, auth.user)
    rows = db.execute(
        select(Share.recipient_id, Share.created_at, User.username_enc, User.public_key)
        .join(User, User.id == Share.recipient_id)
        .where(Share.credential_id == credential_id)
        .order_by(Share.created_at)
    ).all()
    return [
        {
            "recipient_id": r.recipient_id,
            "username": ctx.keys.decrypt(r.username_enc),
            "public_key": r.public_key,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.post("/credentials/{credential_id}/shares", status_code=201)
def share_credential(
    credential_id: str,
    body: ShareIn,
    request: Request,
    auth: Auth = Depends(require_editor),
    db: DbSession = Depends(get_db),
):
    user = auth.user
    _owned(db, credential_id, user)
    if not user.can_share:
        raise HTTPException(status_code=403, detail="An administrator has turned off sharing for your account")
    recipient_id = str(body.recipient_id)
    if recipient_id == user.id:
        raise HTTPException(status_code=400, detail="You already own this entry")
    recipient = db.get(User, recipient_id)
    if recipient is None or not recipient.is_active:
        raise HTTPException(status_code=404, detail="That user was not found")

    share = db.scalar(select(Share).where(Share.credential_id == credential_id, Share.recipient_id == recipient_id))
    if share:
        share.wrapped_key = body.wrapped_key
    else:
        db.add(Share(credential_id=credential_id, recipient_id=recipient_id, wrapped_key=body.wrapped_key))
    audit(db, request, "credential.shared", actor_id=user.id, target=credential_id, detail=f"to={recipient_id}")
    db.commit()
    return {"ok": True}


@router.post("/credentials/{credential_id}/rotate")
def rotate_credential_key(
    credential_id: str,
    body: CredentialRotateIn,
    request: Request,
    auth: Auth = Depends(require_editor),
    db: DbSession = Depends(get_db),
):
    user = auth.user
    _owned(db, credential_id, user)
    kept = {str(s.recipient_id): s.wrapped_key for s in body.shares}
    if len(kept) != len(body.shares):
        raise HTTPException(status_code=400, detail="A recipient is listed more than once")

    now = utcnow()
    version = _bump(
        db, credential_id, body.version, ciphertext=body.ciphertext, wrapped_key=body.wrapped_key, key_rotated_at=now
    )
    shares = db.scalars(select(Share).where(Share.credential_id == credential_id)).all()
    if not set(kept) <= {s.recipient_id for s in shares}:
        db.rollback()
        raise HTTPException(status_code=400, detail="Rotation can only keep people who already have access")
    revoked = []
    for share in shares:
        if share.recipient_id in kept:
            share.wrapped_key = kept[share.recipient_id]
        else:
            revoked.append(share.recipient_id)
            db.delete(share)

    audit(db, request, "credential.key_rotated", actor_id=user.id, target=credential_id)
    for recipient_id in sorted(revoked):
        audit(db, request, "credential.unshared", actor_id=user.id, target=credential_id, detail=f"from={recipient_id}")
    db.commit()
    return {"version": version, "key_rotated_at": now}


@router.delete("/credentials/{credential_id}/shares/me")
def leave_share(
    credential_id: str, request: Request, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)
):
    result = db.execute(
        delete(Share).where(Share.credential_id == credential_id, Share.recipient_id == auth.user.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Entry not found")
    audit(db, request, "credential.share_left", actor_id=auth.user.id, target=credential_id)
    db.commit()
    return {"ok": True}
