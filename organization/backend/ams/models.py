from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, UTCDateTime, utcnow

def new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)

    username_lookup: Mapped[str] = mapped_column(String(64), unique=True)
    username_enc: Mapped[str] = mapped_column(Text)
    email_lookup: Mapped[str] = mapped_column(String(64), unique=True)
    email_enc: Mapped[str] = mapped_column(Text)

    role: Mapped[str] = mapped_column(String(16), default="editor")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    can_share: Mapped[bool] = mapped_column(Boolean, default=True)
    can_edit_profile: Mapped[bool] = mapped_column(Boolean, default=True)
    preferred_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    kdf_salt: Mapped[str] = mapped_column(String(64))
    kdf_time_cost: Mapped[int] = mapped_column(Integer)
    kdf_memory_kib: Mapped[int] = mapped_column(Integer)
    kdf_parallelism: Mapped[int] = mapped_column(Integer)

    auth_hash: Mapped[str] = mapped_column(Text)

    wrapped_vault_key: Mapped[str] = mapped_column(Text)
    public_key: Mapped[str] = mapped_column(Text)
    wrapped_private_key: Mapped[str] = mapped_column(Text)

    recovery_auth_hash: Mapped[str] = mapped_column(Text)
    recovery_wrapped_vault_key: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    password_changed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(256), nullable=True)


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


class Share(Base):
    __tablename__ = "shares"
    __table_args__ = (UniqueConstraint("credential_id", "recipient_id", name="uq_share_recipient"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    credential_id: Mapped[str] = mapped_column(ForeignKey("credentials.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    wrapped_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class EmailCode(Base):
    __tablename__ = "email_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))
    ticket_hash: Mapped[str] = mapped_column(String(64), unique=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    target_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(80), default="")
    role: Mapped[str] = mapped_column(String(16), default="editor")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    used_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_at", "at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(48), index=True)
    target: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
