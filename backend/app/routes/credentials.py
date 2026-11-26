from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..auth import get_current_user, require_editor_or_admin
from ..db import get_db
from ..models import AuditLog, Credential, Share, User
from ..schemas import (
    CreateCredentialIn,
    CredentialListItem,
    CredentialOut,
    ShareBundleOut,
    UpdateCredentialIn,
)
from ..security_config import get_security_config

router = APIRouter(prefix="/credentials", tags=["credentials"])


def _is_rotation_due(last_rotated_at, created_at) -> bool:
    # Uses admin-configurable threshold to mark credentials that should be rotated.
    threshold_days = get_security_config()["credential_rotation_days"]
    base = last_rotated_at or created_at
    if not base:
        return False
    base_dt = base if base.tzinfo else base.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - base_dt).days >= threshold_days


class RotateCredentialKeyIn(UpdateCredentialIn):
    password_ciphertext: str
    data_nonce: str
    record_key_ciphertext: str
    record_key_nonce: str


@router.post("")
@router.post("/")
def create_credential(
    body: CreateCredentialIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    # Request body already contains encrypted payload + wrapped record key from frontend.
    cred = Credential(
        owner_user_id=user.user_id,
        title=body.title,
        system_name=body.system_name,
        password_ciphertext=body.password_ciphertext,
        data_nonce=body.data_nonce,
        record_key_ciphertext=body.record_key_ciphertext,
        record_key_nonce=body.record_key_nonce,
        last_rotated_at=datetime.utcnow(),
    )
    db.add(cred)
    db.flush()
    db.add(AuditLog(user_id=user.user_id, action_type="CREATE_CREDENTIAL", target_id=cred.credential_id))
    db.commit()

    return {"success": True, "credential_id": cred.credential_id}


@router.get("/", response_model=list[CredentialListItem])
def list_credentials(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # User sees owned credentials plus active shares addressed to them.
    owned = db.query(Credential).filter(Credential.owner_user_id == user.user_id).all()

    shared_ids_rows = (
        db.query(Share.credential_id)
        .filter(Share.to_user_id == user.user_id, Share.revoked == False)
        .all()
    )
    shared_ids = {cid for (cid,) in shared_ids_rows}

    shared_creds = []
    if shared_ids:
        shared_creds = db.query(Credential).filter(Credential.credential_id.in_(shared_ids)).all()

    creds = owned + [c for c in shared_creds if c.owner_user_id != user.user_id]

    return [
        CredentialListItem(
            credential_id=c.credential_id,
            owner_user_id=c.owner_user_id,
            title=c.title,
            system_name=c.system_name,
            last_rotated_at=c.last_rotated_at,
            rotation_due=_is_rotation_due(c.last_rotated_at, c.created_at),
        )
        for c in creds
    ]


@router.get("/{credential_id}", response_model=CredentialOut)
def get_credential(
    credential_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Owner gets direct record-key wrapper; shared users receive only their share bundle.
    cred = db.query(Credential).filter(Credential.credential_id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Not found")

    if cred.owner_user_id == user.user_id:
        return CredentialOut(
            credential_id=cred.credential_id,
            owner_user_id=cred.owner_user_id,
            title=cred.title,
            system_name=cred.system_name,
            password_ciphertext=cred.password_ciphertext,
            data_nonce=cred.data_nonce,
            record_key_ciphertext=cred.record_key_ciphertext,
            record_key_nonce=cred.record_key_nonce,
            last_rotated_at=cred.last_rotated_at,
            share_bundle=None,
        )

    share = (
        db.query(Share)
        .filter(
            Share.credential_id == credential_id,
            Share.to_user_id == user.user_id,
            Share.revoked == False,
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=403, detail="No access")

    from_user = db.query(User).filter(User.user_id == share.from_user_id).first()
    if not from_user:
        raise HTTPException(status_code=500, detail="Sharer missing")

    bundle = ShareBundleOut(
        from_user_id=share.from_user_id,
        from_public_key=from_user.public_key,
        shared_record_key_cipher=share.shared_record_key_cipher,
        shared_nonce=share.shared_nonce,
    )

    return CredentialOut(
        credential_id=cred.credential_id,
        owner_user_id=cred.owner_user_id,
        title=cred.title,
        system_name=cred.system_name,
        password_ciphertext=cred.password_ciphertext,
        data_nonce=cred.data_nonce,
        record_key_ciphertext=cred.record_key_ciphertext,
        record_key_nonce=cred.record_key_nonce,
        last_rotated_at=cred.last_rotated_at,
        share_bundle=bundle,
    )


@router.put("/{credential_id}")
def update_credential(
    credential_id: str,
    body: UpdateCredentialIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    cred = db.query(Credential).filter(Credential.credential_id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Not found")

    if cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can edit")

    if body.title is not None:
        cred.title = body.title
    if body.system_name is not None:
        cred.system_name = body.system_name
    if body.password_ciphertext is not None:
        cred.password_ciphertext = body.password_ciphertext
    if body.data_nonce is not None:
        cred.data_nonce = body.data_nonce

    db.add(AuditLog(user_id=user.user_id, action_type="UPDATE_CREDENTIAL", target_id=credential_id))
    db.commit()

    return {"success": True}


@router.post("/{credential_id}/rotate-key")
def rotate_credential_key(
    credential_id: str,
    body: RotateCredentialKeyIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    cred = db.query(Credential).filter(Credential.credential_id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Not found")
    if cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can rotate key")

    # AQA NEA note: server stores only re-encrypted payloads and wrapped record keys during rotation.
    cred.password_ciphertext = body.password_ciphertext
    cred.data_nonce = body.data_nonce
    cred.record_key_ciphertext = body.record_key_ciphertext
    cred.record_key_nonce = body.record_key_nonce
    cred.last_rotated_at = datetime.utcnow()

    db.add(AuditLog(user_id=user.user_id, action_type="ROTATE_CREDENTIAL_KEY", target_id=credential_id))
    db.commit()
    return {"success": True, "last_rotated_at": cred.last_rotated_at}


@router.delete("/{credential_id}")
def delete_credential(
    credential_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    cred = db.query(Credential).filter(Credential.credential_id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Not found")

    if cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can delete")

    db.query(Share).filter(Share.credential_id == credential_id).delete()
    db.query(Credential).filter(Credential.credential_id == credential_id).delete()
    db.add(AuditLog(user_id=user.user_id, action_type="DELETE_CREDENTIAL", target_id=credential_id))
    db.commit()

    return {"success": True}
