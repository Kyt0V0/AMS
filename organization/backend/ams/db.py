from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect):
        return None if value is None else value.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> Engine:
    if not database_url.startswith("sqlite"):
        return create_engine(database_url, pool_pre_ping=True)

    engine = create_engine(database_url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


_ADDED_COLUMNS = [("users", "two_factor_enabled", "BOOLEAN NOT NULL DEFAULT 0")]


def upgrade_schema(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, column, definition in _ADDED_COLUMNS:
            if column not in {c["name"] for c in inspector.get_columns(table)}:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
