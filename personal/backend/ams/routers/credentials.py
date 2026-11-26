from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..core import Auth, current_auth, get_db
from ..db import utcnow
from ..models import Credential
from ..schemas import CredentialCreateIn, CredentialRotateIn, CredentialUpdateIn

router = APIRouter(prefix="/api/credentials", tags=["vault"])

_STALE = "This entry was changed in another window. Reload and try again."


def _existing(db: DbSession, credential_id: str) -> Credential:
    credential = db.get(Credential, credential_id)
    if credential is None:
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


@router.get("")
def list_credentials(_: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    return [
        {
            "id": c.id,
            "ciphertext": c.ciphertext,
            "wrapped_key": c.wrapped_key,
            "version": c.version,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
            "key_rotated_at": c.key_rotated_at,
        }
        for c in db.scalars(select(Credential)).all()
    ]


@router.post("", status_code=201)
def create_credential(body: CredentialCreateIn, auth: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    credential = Credential(
        id=str(body.id), owner_id=auth.user.id, ciphertext=body.ciphertext, wrapped_key=body.wrapped_key
    )
    db.add(credential)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An entry with this id already exists") from None
    return {"id": credential.id, "version": credential.version}


@router.put("/{credential_id}")
def update_credential(
    credential_id: str, body: CredentialUpdateIn, _: Auth = Depends(current_auth), db: DbSession = Depends(get_db)
):
    _existing(db, credential_id)
    version = _bump(db, credential_id, body.version, ciphertext=body.ciphertext)
    db.commit()
    return {"version": version}


@router.post("/{credential_id}/rotate")
def rotate_credential_key(
    credential_id: str, body: CredentialRotateIn, _: Auth = Depends(current_auth), db: DbSession = Depends(get_db)
):
    _existing(db, credential_id)
    now = utcnow()
    version = _bump(
        db, credential_id, body.version, ciphertext=body.ciphertext, wrapped_key=body.wrapped_key, key_rotated_at=now
    )
    db.commit()
    return {"version": version, "key_rotated_at": now}


@router.delete("/{credential_id}")
def delete_credential(credential_id: str, _: Auth = Depends(current_auth), db: DbSession = Depends(get_db)):
    db.delete(_existing(db, credential_id))
    db.commit()
    return {"ok": True}
