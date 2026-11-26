from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

PROJECT_ROOT = Path(__file__).resolve().parents[2]

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def _flag(env: Mapping[str, str], name: str, default: bool | None) -> bool | None:
    value = env.get(name, "").strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    return default


def _int(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(env.get(name, "").strip() or default)
    except ValueError:
        value = default
    return max(low, min(value, high))


def _path(env: Mapping[str, str], name: str) -> Path | None:
    value = env.get(name, "").strip()
    return Path(value).expanduser().resolve() if value else None


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str
    static_dir: Path
    host: str
    port: int
    tls_cert: Path | None
    tls_key: Path | None
    behind_proxy: bool
    allowed_hosts: tuple[str, ...]
    cookie_secure: bool | None
    session_idle_minutes: int
    session_max_hours: int
    secret_key_b64: str | None
    debug: bool
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_security: str = "starttls"
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    email_debug: bool = False

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        if env is None:
            load_env_file(PROJECT_ROOT / ".env")
            env = os.environ

        data_dir = _path(env, "AMS_DATA_DIR") or PROJECT_ROOT / "data"
        security = env.get("AMS_SMTP_SECURITY", "").strip().lower()
        hosts = tuple(h.strip() for h in env.get("AMS_ALLOWED_HOSTS", "").split(",") if h.strip())
        return cls(
            data_dir=data_dir,
            database_url=env.get("AMS_DATABASE_URL", "").strip() or f"sqlite:///{data_dir / 'ams.db'}",
            static_dir=_path(env, "AMS_STATIC_DIR") or PROJECT_ROOT / "frontend" / "dist",
            host=env.get("AMS_HOST", "").strip() or "127.0.0.1",
            port=_int(env, "AMS_PORT", 8000, 1, 65535),
            tls_cert=_path(env, "AMS_TLS_CERT"),
            tls_key=_path(env, "AMS_TLS_KEY"),
            behind_proxy=bool(_flag(env, "AMS_BEHIND_PROXY", False)),
            allowed_hosts=hosts,
            cookie_secure=_flag(env, "AMS_COOKIE_SECURE", None),
            session_idle_minutes=_int(env, "AMS_SESSION_IDLE_MINUTES", 15, 1, 24 * 60),
            session_max_hours=_int(env, "AMS_SESSION_MAX_HOURS", 12, 1, 24 * 30),
            secret_key_b64=env.get("AMS_SECRET_KEY", "").strip() or None,
            debug=bool(_flag(env, "AMS_DEBUG", False)),
            smtp_host=env.get("AMS_SMTP_HOST", "").strip() or None,
            smtp_port=_int(env, "AMS_SMTP_PORT", 587, 1, 65535),
            smtp_security=security if security in {"starttls", "ssl", "none"} else "starttls",
            smtp_user=env.get("AMS_SMTP_USER", "").strip() or None,
            smtp_password=env.get("AMS_SMTP_PASSWORD", "") or None,
            smtp_from=env.get("AMS_SMTP_FROM", "").strip() or None,
            email_debug=bool(_flag(env, "AMS_EMAIL_DEBUG", False)),
        )
