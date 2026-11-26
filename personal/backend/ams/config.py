from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

PROJECT_ROOT = Path(__file__).resolve().parents[2]
HOST = "127.0.0.1"


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
    port: int
    session_idle_minutes: int
    session_max_hours: int
    open_browser: bool

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        if env is None:
            load_env_file(PROJECT_ROOT / ".env")
            env = os.environ
        data_dir = _path(env, "AMS_DATA_DIR") or PROJECT_ROOT / "data"
        return cls(
            data_dir=data_dir,
            database_url=f"sqlite:///{data_dir / 'vault.db'}",
            static_dir=_path(env, "AMS_STATIC_DIR") or PROJECT_ROOT / "frontend" / "dist",
            port=_int(env, "AMS_PORT", 8100, 1, 65535),
            session_idle_minutes=_int(env, "AMS_SESSION_IDLE_MINUTES", 15, 1, 24 * 60),
            session_max_hours=_int(env, "AMS_SESSION_MAX_HOURS", 12, 1, 24 * 30),
            open_browser=env.get("AMS_NO_BROWSER", "").strip().lower() not in {"1", "true", "yes", "on"},
        )
