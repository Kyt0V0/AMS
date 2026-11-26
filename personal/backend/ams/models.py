from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, UTCDateTime, utcnow


def new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64), default="")

    kdf_salt: Mapped[str] = mapped_column(String(64))
    kdf_time_cost: Mapped[int] = mapped_column(Integer)
    kdf_memory_kib: Mapped[int] = mapped_column(Integer)
    kdf_parallelism: Mapped[int] = mapped_column(Integer)

    auth_hash: Mapped[str] = mapped_column(Text)
    wrapped_vault_key: Mapped[str] = mapped_column(Text)
    recovery_auth_hash: Mapped[str] = mapped_column(Text)
    recovery_wrapped_vault_key: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    password_changed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Credential(Base):
    __tablename__ = "credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ciphertext: Mapped[str] = mapped_column(Text)
    wrapped_key: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    key_rotated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Activity(Base):
    __tablename__ = "activity"
    __table_args__ = (Index("ix_activity_at", "at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    action: Mapped[str] = mapped_column(String(48))


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
