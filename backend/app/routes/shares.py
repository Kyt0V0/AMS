from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql import func

from ..auth import require_editor_or_admin
from ..db import get_db
from ..field_crypto import decrypt_str_cached
from ..models import AuditLog, Credential, Share, User
from ..schemas import ShareCreateIn, ShareRecipientOut

router = APIRouter(prefix="/shares", tags=["shares"])


@router.post("")
@router.post("/", response_model=dict)
def create_share(
    body: ShareCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    cred = db.query(Credential).filter(Credential.credential_id == body.credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")

    if cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can share")

    if body.to_user_id == user.user_id:
        raise HTTPException(status_code=400, detail="Cannot share to self")

    recipient = db.query(User).filter(User.user_id == body.to_user_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")

    existing = (
        db.query(Share)
        .filter(
            Share.credential_id == body.credential_id,
            Share.from_user_id == user.user_id,
            Share.to_user_id == body.to_user_id,
        )
        .first()
    )

    if existing:
        # AQA NEA note: only wrapped record-key material is updated; server never receives plaintext credential values.
        existing.shared_record_key_cipher = body.shared_record_key_cipher
        existing.shared_nonce = body.shared_nonce
        existing.revoked = False
        existing.revoked_at = None
    else:
        # AQA NEA note: share rows store encrypted per-recipient key bundles (cipher + nonce), not raw record keys.
        s = Share(
            credential_id=body.credential_id,
            from_user_id=user.user_id,
            to_user_id=body.to_user_id,
            shared_record_key_cipher=body.shared_record_key_cipher,
            shared_nonce=body.shared_nonce,
            revoked=False,
            created_at=datetime.utcnow(),
        )
        db.add(s)

    db.add(AuditLog(user_id=user.user_id, action_type="SHARE", target_id=body.credential_id, details=f"to={body.to_user_id}"))
    db.commit()

    return {"success": True}


@router.get("/credential/{credential_id}", response_model=List[ShareRecipientOut])
def list_shares_for_credential(
    credential_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    cred = db.query(Credential).filter(Credential.credential_id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")

    if cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can view shares")

    recipient_user = aliased(User)
    rows = (
        db.query(Share, recipient_user.username_ciphertext, recipient_user.username_nonce)
        .join(recipient_user, recipient_user.user_id == Share.to_user_id)
        .filter(Share.credential_id == credential_id, Share.from_user_id == user.user_id)
        .order_by(Share.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    out: List[ShareRecipientOut] = []
    for s, username_ciphertext, username_nonce in rows:
        username = "Unknown"
        try:
            username = decrypt_str_cached(username_ciphertext, username_nonce)
        except Exception:
            username = "Unknown"
        out.append(
            ShareRecipientOut(
                share_id=s.share_id,
                to_user_id=s.to_user_id,
                to_username=username,
                revoked=s.revoked,
                created_at=s.created_at,
                revoked_at=s.revoked_at,
            )
        )
    return out


@router.post("/{share_id}/revoke")
def revoke_share(
    share_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor_or_admin),
):
    share = db.query(Share).filter(Share.share_id == share_id).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    cred = db.query(Credential).filter(Credential.credential_id == share.credential_id).first()
    if not cred or cred.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="Only owner can revoke")

    share.revoked = True
    share.revoked_at = func.now()
    db.add(AuditLog(user_id=user.user_id, action_type="REVOKE", target_id=share.share_id))
    db.commit()

    return {"success": True}
