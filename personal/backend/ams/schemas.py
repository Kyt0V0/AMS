from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

_B64 = r"^[A-Za-z0-9+/]+={0,2}$"

Name = Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]
AuthKey = Annotated[str, StringConstraints(pattern=_B64, min_length=44, max_length=44)]
Salt = Annotated[str, StringConstraints(pattern=_B64, min_length=24, max_length=44)]
KeyBlob = Annotated[str, StringConstraints(pattern=_B64, min_length=40, max_length=1024)]
DataBlob = Annotated[str, StringConstraints(pattern=_B64, min_length=40, max_length=200_000)]

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


class SetupIn(PasswordMaterial, RecoveryMaterial):
    name: Name = ""


class LoginIn(Body):
    auth_key: AuthKey


class RecoverStartIn(Body):
    recovery_auth_key: AuthKey


class RecoverFinishIn(PasswordMaterial):
    recovery_auth_key: AuthKey
    new_recovery: RecoveryMaterial


class ProfileIn(Body):
    name: Name


class ChangePasswordIn(PasswordMaterial):
    current_auth_key: AuthKey


class ChangeRecoveryIn(RecoveryMaterial):
    current_auth_key: AuthKey


class ReauthIn(Body):
    current_auth_key: AuthKey


class PreferencesIn(Body):
    kdf_time_cost: int | None = Field(default=None, ge=2, le=10)
    kdf_memory_kib: int | None = Field(default=None, ge=KDF_MEMORY_MIN_KIB, le=KDF_MEMORY_MAX_KIB)
    kdf_parallelism: int | None = Field(default=None, ge=1, le=4)
    min_password_length: int | None = Field(default=None, ge=10, le=64)
    password_max_age_days: int | None = Field(default=None, ge=1, le=3650)
    vault_timeout_minutes: int | None = Field(default=None, ge=1, le=120)


class CredentialCreateIn(Body):
    id: UUID
    ciphertext: DataBlob
    wrapped_key: KeyBlob


class CredentialUpdateIn(Body):
    ciphertext: DataBlob
    version: int = Field(ge=1)


class CredentialRotateIn(Body):
    ciphertext: DataBlob
    wrapped_key: KeyBlob
    version: int = Field(ge=1)
