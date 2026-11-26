from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "security_config.json"

DEFAULT_CONFIG = {
    # AQA NEA note: these values tune Argon2id cost on the client (security vs usability).
    "argon2_time_cost": 3,
    "argon2_memory_kib": 65536,
    "argon2_parallelism": 1,
    "argon2_hash_len": 32,
    # Rotation helper threshold for warning/overdue checks.
    "credential_rotation_days": 180,
}


def _read_file_overrides() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    return raw


def _read_env_overrides() -> dict:
    env_map = {
        "argon2_time_cost": os.getenv("AMS_ARGON2_TIME_COST"),
        "argon2_memory_kib": os.getenv("AMS_ARGON2_MEMORY_KIB"),
        "argon2_parallelism": os.getenv("AMS_ARGON2_PARALLELISM"),
        "argon2_hash_len": os.getenv("AMS_ARGON2_HASH_LEN"),
        "credential_rotation_days": os.getenv("AMS_CREDENTIAL_ROTATION_DAYS"),
    }
    out: dict[str, int] = {}
    for key, value in env_map.items():
        if value is None or not str(value).strip():
            continue
        try:
            out[key] = int(str(value).strip())
        except ValueError:
            continue
    return out


def _validated(cfg: dict) -> dict:
    out = dict(DEFAULT_CONFIG)
    out.update(cfg)

    out["argon2_time_cost"] = max(1, min(int(out["argon2_time_cost"]), 10))
    out["argon2_memory_kib"] = max(8192, min(int(out["argon2_memory_kib"]), 1048576))
    out["argon2_parallelism"] = max(1, min(int(out["argon2_parallelism"]), 8))
    out["argon2_hash_len"] = max(16, min(int(out["argon2_hash_len"]), 64))
    out["credential_rotation_days"] = max(1, min(int(out["credential_rotation_days"]), 3650))
    return out


def get_security_config() -> dict:
    # Priority order: defaults -> local config file -> environment overrides.
    merged = dict(DEFAULT_CONFIG)
    merged.update(_read_file_overrides())
    merged.update(_read_env_overrides())
    return _validated(merged)


def save_security_config(updates: dict) -> dict:
    # Admin updates are validated before persisting to JSON config.
    current = get_security_config()
    current.update(updates)
    validated = _validated(current)
    CONFIG_PATH.write_text(json.dumps(validated, indent=2), encoding="utf-8")
    return validated


def get_public_crypto_config() -> dict:
    cfg = get_security_config()
    return {
        "argon2_time_cost": cfg["argon2_time_cost"],
        "argon2_memory_kib": cfg["argon2_memory_kib"],
        "argon2_parallelism": cfg["argon2_parallelism"],
        "argon2_hash_len": cfg["argon2_hash_len"],
        "credential_rotation_days": cfg["credential_rotation_days"],
    }
