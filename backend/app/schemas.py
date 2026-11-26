from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import datetime



# Request/response schemas keep API contracts explicit for Section 3 implementation evidence.
# For Users

class RegisterUserIn(BaseModel):
    # Client submits wrapped materials only; backend never receives plaintext master password.
    username: str
    email: str
    password_salt: str
    password_verifier: str
    rek_ciphertext: str
    rek_nonce: str
    public_key: str


class UserOut(BaseModel):
    user_id: str
    username: str
    email: str
    password_salt: str
    password_verifier: str
    rek_ciphertext: str
    rek_nonce: str
    public_key: str
    preferred_language: Optional[str] = None
    is_admin: bool = False
    role: str = "editor"
    permissions: Dict[str, bool]


class LoginIn(BaseModel):
    username: str


class LoginMaterialOut(BaseModel):
    success: bool
    user_id: str
    username: str
    email: str
    password_salt: str
    rek_ciphertext: str
    rek_nonce: str
    public_key: str
    preferred_language: Optional[str] = None


class LoginProofIn(BaseModel):
    username: str
    verifier_proof: str


class LoginOut(BaseModel):
    success: bool
    token: str
    token_expires_at: str
    user: UserOut


class PublicUserOut(BaseModel):
    user_id: str
    username: str
    public_key: str




# For Credentials

class CreateCredentialIn(BaseModel):
    # Credential payload and key fields arrive already encrypted from frontend.
    title: str
    system_name: str
    password_ciphertext: str
    data_nonce: str
    record_key_ciphertext: str
    record_key_nonce: str


class CredentialListItem(BaseModel):
    credential_id: str
    owner_user_id: str
    title: str
    system_name: str
    last_rotated_at: Optional[datetime] = None
    rotation_due: bool = False


class UpdateCredentialIn(BaseModel):
    title: Optional[str] = None
    system_name: Optional[str] = None
    password_ciphertext: Optional[str] = None
    data_nonce: Optional[str] = None


class PublicUserOut(BaseModel):
    user_id: str
    username: str
    public_key: str


class ShareCreateIn(BaseModel):
    credential_id: str
    to_user_id: str
    shared_record_key_cipher: str
    shared_nonce: str


class ShareRecipientOut(BaseModel):
    share_id: str
    to_user_id: str
    to_username: str
    revoked: bool
    created_at: datetime
    revoked_at: Optional[datetime] = None


class ShareBundleOut(BaseModel):
    from_user_id: str
    from_public_key: str
    shared_record_key_cipher: str
    shared_nonce: str


class CredentialOut(BaseModel):
    credential_id: str
    owner_user_id: str
    title: str
    system_name: str
    password_ciphertext: str
    data_nonce: str
    record_key_ciphertext: str
    record_key_nonce: str
    last_rotated_at: Optional[datetime] = None
    share_bundle: Optional[ShareBundleOut] = None
