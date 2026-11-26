import os
import base64
import hmac
import hashlib
from functools import lru_cache
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_KEY_FILE = Path(__file__).resolve().parents[1] / "app_key.bin"
_LEGACY_KEY_FILE = Path(__file__).resolve().parents[1] / "app_key_b64.txt"

_cached_key: bytes | None = None


def _load_or_create_key_b64() -> str:
    env = os.getenv("AMS_APP_KEY_BASE64", "").strip()
    if env:
        return env

    # Prefer persistent binary key file so encrypted fields remain decryptable across restarts.
    if _KEY_FILE.exists():
        return base64.b64encode(_KEY_FILE.read_bytes()).decode("utf-8")

    if _LEGACY_KEY_FILE.exists():
        key_b64 = _LEGACY_KEY_FILE.read_text(encoding="utf-8").strip()
        key = base64.b64decode(key_b64)
        if len(key) != 32:
            raise RuntimeError("Legacy app key must decode to 32 bytes")
        _KEY_FILE.write_bytes(key)
        return key_b64

    key_b64 = base64.b64encode(os.urandom(32)).decode("utf-8")
    _KEY_FILE.write_bytes(base64.b64decode(key_b64))
    return key_b64


def _get_app_key() -> bytes:
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    key_b64 = _load_or_create_key_b64()
    key = base64.b64decode(key_b64)

    if len(key) != 32:
        raise RuntimeError("App key must be 32 bytes (base64-encoded)")

    _cached_key = key
    return key


def normalize(s: str) -> str:
    return s.strip().lower()


def lookup_hash(value: str) -> str:
    # Deterministic keyed hash supports username/email lookup without storing plaintext.
    key = _get_app_key()
    msg = normalize(value).encode("utf-8")
    digest = hmac.new(key, msg, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def encrypt_str(value: str) -> tuple[str, str]:
    # Encrypt PII fields at rest (username/email) using app-managed AES key.
    key = _get_app_key()
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, value.encode("utf-8"), None)
    return base64.b64encode(ct).decode("utf-8"), base64.b64encode(nonce).decode("utf-8")


def decrypt_str(ciphertext_b64: str, nonce_b64: str) -> str:
    key = _get_app_key()
    aes = AESGCM(key)
    ct = base64.b64decode(ciphertext_b64)
    nonce = base64.b64decode(nonce_b64)
    pt = aes.decrypt(nonce, ct, None)
    return pt.decode("utf-8")


@lru_cache(maxsize=4096)
def decrypt_str_cached(ciphertext_b64: str, nonce_b64: str) -> str:
    return decrypt_str(ciphertext_b64, nonce_b64)


def ensure_app_key() -> None:
    # Called at startup to guarantee key exists before any encrypt/decrypt operations.
    _get_app_key()
