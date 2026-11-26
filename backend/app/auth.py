import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User

bearer = HTTPBearer(auto_error=False)
_JWT_SECRET_PATH = Path(__file__).resolve().parents[1] / "jwt_secret.txt"


def _get_jwt_secret() -> str:
    env_secret = os.getenv("AMS_JWT_SECRET", "").strip()
    if env_secret:
        return env_secret

    if _JWT_SECRET_PATH.exists():
        return _JWT_SECRET_PATH.read_text(encoding="utf-8").strip()

    secret = secrets.token_urlsafe(64)
    _JWT_SECRET_PATH.write_text(secret, encoding="utf-8")
    return secret


def _jwt_ttl_minutes() -> int:
    raw = os.getenv("AMS_JWT_TTL_MINUTES", "30").strip()
    try:
        ttl = int(raw)
    except ValueError:
        return 30
    return max(5, min(ttl, 24 * 60))


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def _sign(signing_input: str) -> str:
    secret = _get_jwt_secret().encode("utf-8")
    sig = hmac.new(secret, signing_input.encode("ascii"), hashlib.sha256).digest()
    return _b64url_encode(sig)


def create_access_token(user_id: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=_jwt_ttl_minutes())

    # AQA NEA note: token includes subject + expiry so sessions can be validated server-side without storing plaintext credentials.
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": user_id, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}"
    token = f"{signing_input}.{_sign(signing_input)}"
    return token, exp.isoformat()


def _decode_token(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Invalid token")

    header_b64, payload_b64, signature = parts
    signing_input = f"{header_b64}.{payload_b64}"
    expected_sig = _sign(signing_input)
    # AQA NEA note: signature check prevents token tampering before user lookup.
    if not hmac.compare_digest(signature, expected_sig):
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    exp = int(payload.get("exp", 0))
    if exp <= int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=401, detail="Token expired")

    return payload


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing token")

    payload = _decode_token(creds.credentials)
    user_id = str(payload.get("sub", ""))
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    role = getattr(user, "role", "editor")
    if not user.is_admin and role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def require_editor_or_admin(user: User = Depends(get_current_user)) -> User:
    role = getattr(user, "role", "editor")
    if user.is_admin or role == "admin":
        return user
    if role != "editor":
        raise HTTPException(status_code=403, detail="Editor role required")
    return user


def require_permission(flag: str):
    # Reusable permission dependency with automatic admin bypass.
    def dep(user: User = Depends(get_current_user)) -> User:
        role = getattr(user, "role", "editor")
        if user.is_admin or role == "admin":
            return user
        allowed = getattr(user, flag, False)
        if not allowed:
            raise HTTPException(status_code=403, detail=f"Permission denied: {flag}")
        return user

    return dep
