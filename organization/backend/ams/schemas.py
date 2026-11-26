from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

_B64 = r"^[A-Za-z0-9+/]+={0,2}$"

Username = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9._-]{3,32}$")]
Email = Annotated[str, StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
LoginName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
AuthKey = Annotated[str, StringConstraints(pattern=_B64, min_length=44, max_length=44)]
Salt = Annotated[str, StringConstraints(pattern=_B64, min_length=24, max_length=44)]
KeyBlob = Annotated[str, StringConstraints(pattern=_B64, min_length=40, max_length=1024)]
DataBlob = Annotated[str, StringConstraints(pattern=_B64, min_length=40, max_length=200_000)]
Token = Annotated[str, StringConstraints(strip_whitespace=True, min_length=16, max_length=128)]
Role = Literal["admin", "editor", "viewer"]

KDF_MEMORY_MIN_KIB = 19456
KDF_MEMORY_MAX_KIB = 1048576


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KdfParams(Body):
    salt: Salt
    time_cost: int = Field(ge=2, le=10)
    memory_kib: int = Field(ge=KDF_MEMORY_MIN_KIB, le=KDF_MEMORY_MAX_KIB)
    parallelism: int = Field(ge=1, le=4)


class RecoveryMaterial(Body):
    recovery_auth_key: AuthKey
    recovery_wrapped_vault_key: KeyBlob


class PasswordMaterial(Body):
    kdf: KdfParams
    auth_key: AuthKey
    wrapped_vault_key: KeyBlob


class RegisterIn(PasswordMaterial, RecoveryMaterial):
    username: Username
    email: Email
    public_key: KeyBlob
    wrapped_private_key: KeyBlob
    invite_token: Token | None = None
    setup_token: Token | None = None


class TokenIn(Body):
    token: Token


class PreloginIn(Body):
    username: LoginName


class LoginIn(Body):
    username: LoginName
    auth_key: AuthKey


Code = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{6}$")]


class LoginVerifyIn(Body):
    ticket: Token
    code: Code


class TicketIn(Body):
    ticket: Token


class CodeIn(Body):
    code: Code


class EmailChangeIn(Body):
    email: Email
    current_auth_key: AuthKey


class RecoverStartIn(Body):
    username: LoginName
    recovery_auth_key: AuthKey


class RecoverFinishIn(PasswordMaterial):
    username: LoginName
    recovery_auth_key: AuthKey
    new_recovery: RecoveryMaterial


class ProfileIn(Body):
    username: Username | None = None
    email: Email | None = None
    preferred_language: Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")] | None = None
    current_auth_key: AuthKey | None = None


class ChangePasswordIn(PasswordMaterial):
    current_auth_key: AuthKey


class ChangeRecoveryIn(RecoveryMaterial):
    current_auth_key: AuthKey


class ReauthIn(Body):
    current_auth_key: AuthKey


class CredentialCreateIn(Body):
    id: UUID
    ciphertext: DataBlob
    wrapped_key: KeyBlob


class CredentialUpdateIn(Body):
    ciphertext: DataBlob
    version: int = Field(ge=1)


class ShareIn(Body):
    recipient_id: UUID
    wrapped_key: KeyBlob


class CredentialRotateIn(Body):
    ciphertext: DataBlob
    wrapped_key: KeyBlob
    version: int = Field(ge=1)
    shares: list[ShareIn] = Field(default_factory=list, max_length=500)


class AdminUserIn(Body):
    role: Role | None = None
    is_active: bool | None = None
    can_share: bool | None = None
    can_edit_profile: bool | None = None
    two_factor_enabled: Literal[False] | None = None


class InviteIn(Body):
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    role: Role = "editor"
    expires_in_days: int = Field(default=7, ge=1, le=30)


class PolicyIn(Body):
    kdf_time_cost: int | None = Field(default=None, ge=2, le=10)
    kdf_memory_kib: int | None = Field(default=None, ge=KDF_MEMORY_MIN_KIB, le=KDF_MEMORY_MAX_KIB)
    kdf_parallelism: int | None = Field(default=None, ge=1, le=4)
    min_password_length: int | None = Field(default=None, ge=10, le=64)
    password_max_age_days: int | None = Field(default=None, ge=1, le=3650)
    vault_timeout_minutes: int | None = Field(default=None, ge=1, le=120)
    open_registration: bool | None = None
    require_two_factor: bool | None = None
