from __future__ import annotations

import os
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def data_dir() -> Path:
    load_env()
    value = os.environ.get("AMS_DATA_DIR", "").strip()
    return Path(value).expanduser().resolve() if value else ROOT / "data"


def lan_address() -> str | None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()


def host_names(extra: list[str]) -> list[str]:
    host = socket.gethostname()
    candidates = ["localhost", "127.0.0.1", "::1", host, lan_address(), *extra]
    if host and "." not in host:
        candidates.append(f"{host}.local")

    names: list[str] = []
    for value in candidates:
        if value and value.lower() not in (name.lower() for name in names):
            names.append(value)
    return names
