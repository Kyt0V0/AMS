from __future__ import annotations

from sqlalchemy import inspect, text

from .db import Base, engine
from . import models  # noqa: F401


MIGRATION_IDS = (
    "0001_create_tables",
    "0002_users_rbac_columns",
    "0003_share_perf_indexes",
)


def _ensure_migrations_table() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    migration_id TEXT PRIMARY KEY,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )


def _applied_migrations() -> set[str]:
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT migration_id FROM schema_migrations")).all()
    return {r[0] for r in rows}


def _mark_applied(migration_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (migration_id) VALUES (:migration_id)"),
            {"migration_id": migration_id},
        )


def _migration_0001_create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def _migration_0002_users_rbac_columns() -> None:
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return

    existing = {c["name"] for c in insp.get_columns("users")}
    columns = [
        ("is_admin", "BOOLEAN", "0"),
        ("role", "TEXT", "'editor'"),
        ("can_change_username", "BOOLEAN", "1"),
        ("can_change_email", "BOOLEAN", "1"),
        ("can_change_password", "BOOLEAN", "1"),
        ("can_share", "BOOLEAN", "1"),
    ]

    with engine.begin() as conn:
        for name, sql_type, default in columns:
            if name in existing:
                continue
            conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {sql_type} DEFAULT {default} NOT NULL"))

        conn.execute(text("UPDATE users SET role = 'admin' WHERE is_admin = 1"))
        conn.execute(text("UPDATE users SET role = 'editor' WHERE role NOT IN ('admin', 'editor', 'viewer')"))


def _migration_0003_share_perf_indexes() -> None:
    with engine.begin() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_shares_credential_from ON shares (credential_id, from_user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_shares_to_revoked ON shares (to_user_id, revoked)"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_shares_credential_to_revoked "
                "ON shares (credential_id, to_user_id, revoked)"
            )
        )


MIGRATIONS = {
    "0001_create_tables": _migration_0001_create_tables,
    "0002_users_rbac_columns": _migration_0002_users_rbac_columns,
    "0003_share_perf_indexes": _migration_0003_share_perf_indexes,
}


def apply_migrations() -> None:
    # Lightweight migration runner keeps SQLite schema consistent across classroom/demo restarts.
    _ensure_migrations_table()
    applied = _applied_migrations()

    for migration_id in MIGRATION_IDS:
        if migration_id in applied:
            continue
        MIGRATIONS[migration_id]()
        _mark_applied(migration_id)


if __name__ == "__main__":
    apply_migrations()
