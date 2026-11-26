from __future__ import annotations

import os
import secrets
from pathlib import Path

TOKEN_PATH = Path(__file__).resolve().parents[1] / "bootstrap_token.txt"


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def get_bootstrap_token() -> str:
    # Optional env override lets admins manage bootstrap token outside local file storage.
    env = os.getenv("BOOTSTRAP_ADMIN_TOKEN")
    if env and env.strip():
        return env.strip()

    if TOKEN_PATH.exists():
        return TOKEN_PATH.read_text(encoding="utf-8").strip()

    token = _generate_token()
    TOKEN_PATH.write_text(token, encoding="utf-8")
    return token


def rotate_bootstrap_token() -> str:
    # Rotate after successful claim so bootstrap token is single-use in normal operation.
    env = os.getenv("BOOTSTRAP_ADMIN_TOKEN")
    if env and env.strip():
        return env.strip()

    token = _generate_token()
    TOKEN_PATH.write_text(token, encoding="utf-8")
    return token
