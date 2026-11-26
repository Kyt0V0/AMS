from __future__ import annotations

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def hash_secret(secret: str) -> str:
    return _hasher.hash(secret)


def verify_secret(stored_hash: str, secret: str) -> bool:
    try:
        return _hasher.verify(stored_hash, secret)
    except (VerificationError, InvalidHashError):
        return False


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
