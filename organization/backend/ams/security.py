from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import secrets
import unicodedata
from functools import lru_cache
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import Settings

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_secret(secret: str) -> str:
    return _hasher.hash(secret)


def verify_secret(stored_hash: str | None, secret: str) -> bool:
    try:
        _hasher.verify(stored_hash or _DUMMY_HASH, secret)
    except (VerificationError, InvalidHashError):
        return False
    return stored_hash is not None


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def normalize_identity(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def is_valid_public_key(public_key_b64: str) -> bool:
    try:
        raw = base64.b64decode(public_key_b64, validate=True)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except (ValueError, binascii.Error):
        return False
    return len(raw) == 65


def _derive(master: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(master)


def _load_master_key(settings: Settings) -> bytes:
    if settings.secret_key_b64:
        key = base64.b64decode(settings.secret_key_b64)
    else:
        path: Path = settings.data_dir / "secret.key"
        if path.exists():
            key = path.read_bytes()
        else:
            key = os.urandom(32)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(key)
    if len(key) != 32:
        raise RuntimeError("The AMS server key must be exactly 32 bytes (base64-encoded in AMS_SECRET_KEY).")
    return key


class ServerKeys:
    def __init__(self, master: bytes):
        self._lookup_key = _derive(master, b"ams/server/lookup")
        self._decoy_key = _derive(master, b"ams/server/decoy-salt")
        self._field = AESGCM(_derive(master, b"ams/server/field"))
        self.decrypt = lru_cache(maxsize=8192)(self._decrypt)

    @classmethod
    def load(cls, settings: Settings) -> "ServerKeys":
        return cls(_load_master_key(settings))

    def lookup(self, value: str) -> str:
        return hmac.new(self._lookup_key, normalize_identity(value).encode("utf-8"), hashlib.sha256).hexdigest()

    def encrypt(self, value: str) -> str:
        nonce = os.urandom(12)
        return base64.b64encode(nonce + self._field.encrypt(nonce, value.encode("utf-8"), None)).decode("ascii")

    def _decrypt(self, blob: str) -> str:
        raw = base64.b64decode(blob)
        return self._field.decrypt(raw[:12], raw[12:], None).decode("utf-8")

    def decoy_salt(self, username: str) -> str:
        digest = hmac.new(self._decoy_key, normalize_identity(username).encode("utf-8"), hashlib.sha256).digest()
        return base64.b64encode(digest[:16]).decode("ascii")
