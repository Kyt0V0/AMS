from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..bootstrap import get_bootstrap_token, rotate_bootstrap_token
from ..db import get_db
from ..field_crypto import decrypt_str_cached
from ..models import AuditLog, Credential, Share, User
from ..security_config import get_security_config, save_security_config
from ..integrations import get_account_sync_provider

from ..field_crypto import encrypt_str, lookup_hash

router = APIRouter(prefix="/admin", tags=["admin"])


class SetPermissionsIn(BaseModel):
    can_change_username: bool | None = None
    can_change_email: bool | None = None
    can_change_password: bool | None = None
    can_share: bool | None = None


class SetAdminIn(BaseModel):
    is_admin: bool


class SetRoleIn(BaseModel):
    role: Literal["admin", "editor", "viewer"]


class BootstrapStatusOut(BaseModel):
    needs_bootstrap: bool


class BootstrapClaimIn(BaseModel):
    token: str

    username: str
    email: str

    password_salt: str
    password_verifier: str

    rek_ciphertext: str
    rek_nonce: str

    public_key: str


class UpdateCryptoConfigIn(BaseModel):
    argon2_time_cost: int | None = None
    argon2_memory_kib: int | None = None
    argon2_parallelism: int | None = None
    argon2_hash_len: int | None = None
    credential_rotation_days: int | None = None


def _user_plain(u: User) -> dict[str, Any]:
    # Admin API returns decrypted identity fields for management UI only (admin-protected route).
    role = getattr(u, "role", "editor")
    is_admin = bool(u.is_admin) or role == "admin"
    return {
        "user_id": u.user_id,
        "username": decrypt_str_cached(u.username_ciphertext, u.username_nonce),
        "email": decrypt_str_cached(u.email_ciphertext, u.email_nonce),
        "is_admin": is_admin,
        "role": "admin" if is_admin else role,
        "permissions": {
            "can_change_username": bool(u.can_change_username),
            "can_change_email": bool(u.can_change_email),
            "can_change_password": bool(u.can_change_password),
            "can_share": bool(u.can_share),
        },
        "created_at": u.created_at,
        "last_login": u.last_login,
    }


@router.get("/bootstrap/status", response_model=BootstrapStatusOut)
def bootstrap_status(db: Session = Depends(get_db)):
    """
    If there are no users, the system needs an initial admin claim.
    """
    user_exists = db.query(User.user_id).first() is not None
    return {"needs_bootstrap": not user_exists}


@router.post("/bootstrap/claim")
def bootstrap_claim(body: BootstrapClaimIn, db: Session = Depends(get_db)):
    # First user claim path creates initial admin without storing any plaintext secrets.
    if db.query(User.user_id).first() is not None:
        raise HTTPException(status_code=409, detail="Bootstrap already completed")

    expected = get_bootstrap_token()
    if body.token != expected:
        raise HTTPException(status_code=403, detail="Invalid bootstrap token")

    username_hash = lookup_hash(body.username)
    email_hash = lookup_hash(body.email)

    username_ciphertext, username_nonce = encrypt_str(body.username)
    email_ciphertext, email_nonce = encrypt_str(body.email)

    u = User(
        username_hash=username_hash,
        username_ciphertext=username_ciphertext,
        username_nonce=username_nonce,
        email_hash=email_hash,
        email_ciphertext=email_ciphertext,
        email_nonce=email_nonce,
        password_salt=body.password_salt,
        password_verifier=body.password_verifier,
        rek_ciphertext=body.rek_ciphertext,
        rek_nonce=body.rek_nonce,
        public_key=body.public_key,
        is_admin=True,
        role="admin",
        can_change_username=True,
        can_change_email=True,
        can_change_password=True,
        can_share=True,
    )

    db.add(u)
    db.flush()

    db.add(
        AuditLog(
            user_id=u.user_id,
            action_type="BOOTSTRAP_ADMIN",
            target_id=u.user_id,
            details="Initial admin created via bootstrap",
        )
    )

    db.commit()

    rotate_bootstrap_token()

    return {"success": True, "user_id": u.user_id}


@router.get("/users")
def list_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return [_user_plain(u) for u in users]


@router.put("/users/{user_id}/permissions")
def set_permissions(
    user_id: str,
    body: SetPermissionsIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if body.can_change_username is not None:
        u.can_change_username = bool(body.can_change_username)
    if body.can_change_email is not None:
        u.can_change_email = bool(body.can_change_email)
    if body.can_change_password is not None:
        u.can_change_password = bool(body.can_change_password)
    if body.can_share is not None:
        u.can_share = bool(body.can_share)

    # Viewer remains read-only even if manual permission flags are toggled.
    if u.role == "viewer":
        u.can_change_username = False
        u.can_change_email = False
        u.can_change_password = False
        u.can_share = False

    db.add(
        AuditLog(
            user_id=admin.user_id,
            action_type="SET_PERMISSIONS",
            target_id=user_id,
            details=f"username_hash={u.username_hash}",
        )
    )

    db.commit()
    return {"success": True}


@router.put("/users/{user_id}/admin")
def set_admin(
    user_id: str,
    body: SetAdminIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    u.is_admin = bool(body.is_admin)
    if u.is_admin:
        u.role = "admin"
    elif u.role == "admin":
        u.role = "editor"

    db.add(
        AuditLog(
            user_id=admin.user_id,
            action_type="SET_ADMIN",
            target_id=user_id,
            details=f"is_admin={u.is_admin}",
        )
    )

    db.commit()
    return {"success": True}


@router.put("/users/{user_id}/role")
def set_role(
    user_id: str,
    body: SetRoleIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    u.role = body.role
    u.is_admin = body.role == "admin"

    if body.role == "viewer":
        # AQA NEA note: viewer is read-only for credentials in this implementation.
        u.can_change_username = False
        u.can_change_email = False
        u.can_change_password = False
        u.can_share = False
    elif body.role == "editor":
        u.can_change_username = True
        u.can_change_email = True
        u.can_change_password = True
        u.can_share = True

    db.add(
        AuditLog(
            user_id=admin.user_id,
            action_type="SET_ROLE",
            target_id=user_id,
            details=f"role={u.role}",
        )
    )
    db.commit()
    return {"success": True}


@router.get("/crypto-config")
def get_crypto_config(_: User = Depends(require_admin)):
    return get_security_config()


@router.put("/crypto-config")
def update_crypto_config(
    body: UpdateCryptoConfigIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # Security parameters are centrally validated before saving.
    updates = body.model_dump(exclude_none=True)
    cfg = save_security_config(updates)
    db.add(
        AuditLog(
            user_id=admin.user_id,
            action_type="UPDATE_CRYPTO_CONFIG",
            target_id=admin.user_id,
            details=f"updated_at={datetime.utcnow().isoformat()}",
        )
    )
    db.commit()
    return cfg


@router.get("/integrations/status")
def integrations_status(_: User = Depends(require_admin)):
    return get_account_sync_provider().status()


@router.get("/db/credentials")
def db_credentials(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(Credential).order_by(Credential.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "credential_id": c.credential_id,
            "owner_user_id": c.owner_user_id,
            "title": c.title,
            "system_name": c.system_name,
            "password_ciphertext": c.password_ciphertext,
            "data_nonce": c.data_nonce,
            "record_key_ciphertext": c.record_key_ciphertext,
            "record_key_nonce": c.record_key_nonce,
            "created_at": c.created_at,
            "last_rotated_at": c.last_rotated_at,
        }
        for c in rows
    ]


@router.get("/db/users")
def db_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    # Metadata endpoint supports admin verification/testing screenshots in NEA report.
    rows = db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "user_id": u.user_id,
            "username_hash": u.username_hash,
            "username_ciphertext": u.username_ciphertext,
            "username_nonce": u.username_nonce,
            "email_hash": u.email_hash,
            "email_ciphertext": u.email_ciphertext,
            "email_nonce": u.email_nonce,
            "password_salt": u.password_salt,
            "password_verifier": u.password_verifier,
            "rek_ciphertext": u.rek_ciphertext,
            "rek_nonce": u.rek_nonce,
            "public_key": u.public_key,
            "role": u.role,
            "is_admin": u.is_admin,
            "can_change_username": u.can_change_username,
            "can_change_email": u.can_change_email,
            "can_change_password": u.can_change_password,
            "can_share": u.can_share,
            "created_at": u.created_at,
            "last_login": u.last_login,
        }
        for u in rows
    ]


@router.get("/db/shares")
def db_shares(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(Share).order_by(Share.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "share_id": s.share_id,
            "credential_id": s.credential_id,
            "from_user_id": s.from_user_id,
            "to_user_id": s.to_user_id,
            "shared_record_key_cipher": s.shared_record_key_cipher,
            "shared_nonce": s.shared_nonce,
            "revoked": s.revoked,
            "created_at": s.created_at,
            "revoked_at": s.revoked_at,
        }
        for s in rows
    ]


@router.get("/audit")
def audit(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()
    return [
        {
            "log_id": r.log_id,
            "user_id": r.user_id,
            "action_type": r.action_type,
            "target_id": r.target_id,
            "details": r.details,
            "timestamp": r.timestamp,
        }
        for r in rows
    ]
