from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_users_rbac_columns(engine: Engine) -> None:
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

        # Keep role data aligned with legacy is_admin flag.
        conn.execute(text("UPDATE users SET role = 'admin' WHERE is_admin = 1"))
        conn.execute(text("UPDATE users SET role = 'editor' WHERE role NOT IN ('admin', 'editor', 'viewer')"))
