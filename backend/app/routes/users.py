from typing import List
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
import hmac
from ..db import get_db
from ..auth import create_access_token, get_current_user, require_permission
from ..field_crypto import lookup_hash, encrypt_str, decrypt_str, decrypt_str_cached
from ..models import User, AuditLog, Share, Credential#, UserRole
from ..schemas import RegisterUserIn, LoginIn, LoginMaterialOut, LoginProofIn, LoginOut, UserOut, PublicUserOut
from ..security_config import get_public_crypto_config

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/register")
def register_user(body: RegisterUserIn, db: Session = Depends(get_db)):
    # Hashes are used for lookup uniqueness, while ciphertext/nonce fields protect identity data at rest.
    u_hash = lookup_hash(body.username)
    e_hash = lookup_hash(body.email)

    existing = db.query(User).filter((User.username_hash == u_hash) | (User.email_hash == e_hash)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")

    u_ct, u_nonce = encrypt_str(body.username)
    e_ct, e_nonce = encrypt_str(body.email)

    user = User(
        user_id=str(uuid4()),
        username_hash=u_hash,
        username_ciphertext=u_ct,
        username_nonce=u_nonce,
        email_hash=e_hash,
        email_ciphertext=e_ct,
        email_nonce=e_nonce,
        password_salt=body.password_salt,
        password_verifier=body.password_verifier,
        rek_ciphertext=body.rek_ciphertext,
        rek_nonce=body.rek_nonce,
        public_key=body.public_key,
        created_at=datetime.utcnow(),
    )

    db.add(user)
    db.flush()
    db.add(AuditLog(user_id=user.user_id, action_type="REGISTER", target_id=user.user_id))
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        msg = str(getattr(e, "orig", e))
        if "UNIQUE constraint failed" in msg:
            raise HTTPException(status_code=400, detail="Username or email already exists")
        raise HTTPException(status_code=400, detail=f"Registration failed: {msg}")

    return {"success": True, "user_id": user.user_id}


@router.post("/login/material", response_model=LoginMaterialOut)
def login_material(body: LoginIn, db: Session = Depends(get_db)):
    # AQA NEA note: step 1 returns only salt + encrypted key material; no access token is issued here.
    u_hash = lookup_hash(body.username)
    user = db.query(User).filter(User.username_hash == u_hash).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return LoginMaterialOut(
        success=True,
        user_id=user.user_id,
        username=decrypt_str(user.username_ciphertext, user.username_nonce),
        email=decrypt_str(user.email_ciphertext, user.email_nonce),
        password_salt=user.password_salt,
        rek_ciphertext=user.rek_ciphertext,
        rek_nonce=user.rek_nonce,
        public_key=user.public_key,
        preferred_language=user.preferred_language,
    )


@router.post("/login/proof", response_model=LoginOut)
def login_proof(body: LoginProofIn, db: Session = Depends(get_db)):
    # AQA NEA note: token issuance occurs only after verifier proof matches stored verifier.
    u_hash = lookup_hash(body.username)
    user = db.query(User).filter(User.username_hash == u_hash).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not hmac.compare_digest(body.verifier_proof, user.password_verifier):
        raise HTTPException(status_code=401, detail="Invalid login proof")

    token, token_expires_at = create_access_token(user.user_id)
    user.last_login = datetime.utcnow()

    db.add(AuditLog(user_id=user.user_id, action_type="LOGIN", target_id=user.user_id))
    db.commit()

    return LoginOut(
        success=True,
        token=token,
        token_expires_at=token_expires_at,
        user=UserOut(
            user_id=user.user_id,
            username=decrypt_str(user.username_ciphertext, user.username_nonce),
            email=decrypt_str(user.email_ciphertext, user.email_nonce),
            password_salt=user.password_salt,
            password_verifier=user.password_verifier,
            rek_ciphertext=user.rek_ciphertext,
            rek_nonce=user.rek_nonce,
            public_key=user.public_key,
            preferred_language=user.preferred_language,
            is_admin=bool(user.is_admin) or getattr(user, "role", "editor") == "admin",
            role=getattr(user, "role", "editor"),
            permissions={
                "can_change_username": bool(user.can_change_username),
                "can_change_email": bool(user.can_change_email),
                "can_change_password": bool(user.can_change_password),
                "can_share": bool(user.can_share),
            },
        ),
    )


class UpdateUsernameIn(BaseModel):
    username: str

@router.put("/me/username")
def update_my_username(
    body: UpdateUsernameIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("can_change_username")),
):
    new_hash = lookup_hash(body.username)
    exists = db.query(User).filter(User.username_hash == new_hash, User.user_id != user.user_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Username already in use")

    ct, nonce = encrypt_str(body.username)
    user.username_hash = new_hash
    user.username_ciphertext = ct
    user.username_nonce = nonce
    db.add(AuditLog(user_id=user.user_id, action_type="UPDATE_USERNAME", target_id=user.user_id))
    db.commit()

    return {"success": True}


class UpdateEmailIn(BaseModel):
    email: str


@router.put("/me/email")
def update_my_email(
    body: UpdateEmailIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("can_change_email")),
):
    new_hash = lookup_hash(body.email)
    exists = db.query(User).filter(User.email_hash == new_hash, User.user_id != user.user_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already in use")

    ct, nonce = encrypt_str(body.email)
    user.email_hash = new_hash
    user.email_ciphertext = ct
    user.email_nonce = nonce
    db.add(AuditLog(user_id=user.user_id, action_type="UPDATE_EMAIL", target_id=user.user_id))
    db.commit()

    return {"success": True}


class UpdatePasswordIn(BaseModel):
    password_salt: str
    password_verifier: str
    rek_ciphertext: str
    rek_nonce: str


class ReportDecryptFailureIn(BaseModel):
    stage: str
    credential_id: str | None = None
    reason: str | None = None


@router.put("/me/password")
def update_my_password(
    body: UpdatePasswordIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("can_change_password")),
):
    # Password update replaces verifier + wrapped REK only; encrypted credentials remain unchanged.
    user.password_salt = body.password_salt
    user.password_verifier = body.password_verifier
    user.rek_ciphertext = body.rek_ciphertext
    user.rek_nonce = body.rek_nonce
    db.add(AuditLog(user_id=user.user_id, action_type="UPDATE_PASSWORD", target_id=user.user_id))
    db.commit()

    return {"success": True}


@router.get("/crypto-config")
def get_crypto_config():
    return get_public_crypto_config()


@router.post("/me/decrypt-failure")
def report_decrypt_failure(
    body: ReportDecryptFailureIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # AQA NEA note: failed decrypt events are logged for monitoring without storing plaintext secrets.
    details = f"stage={body.stage}"
    if body.credential_id:
        details += f";credential_id={body.credential_id}"
    if body.reason:
        # Keep details bounded for safety/log readability.
        details += f";reason={body.reason[:200]}"

    db.add(
        AuditLog(
            user_id=user.user_id,
            action_type="DECRYPT_FAILURE",
            target_id=body.credential_id,
            details=details,
        )
    )
    db.commit()
    return {"success": True}


@router.delete("/me")
def delete_my_account(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Manual delete order keeps SQLite constraints simple for NEA project scope.
    uid = user.user_id
    db.query(Share).filter((Share.from_user_id == uid) | (Share.to_user_id == uid)).delete()
    db.query(Credential).filter(Credential.owner_user_id == uid).delete()
    db.query(AuditLog).filter(AuditLog.user_id == uid).delete()
    db.query(User).filter(User.user_id == uid).delete()
    db.commit()
    return {"success": True}


@router.get("/public", response_model=List[PublicUserOut])
def list_public_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    users = db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    out: List[PublicUserOut] = []
    for u in users:
        out.append(
            PublicUserOut(
                user_id=u.user_id,
                username=decrypt_str_cached(u.username_ciphertext, u.username_nonce),
                public_key=u.public_key,
            )
        )
    return out
