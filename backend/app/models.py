import uuid
from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, Text, Index
from sqlalchemy.sql import func
from .db import Base


def gen_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True, default=gen_uuid)

    username_hash = Column(String, unique=True, index=True, nullable=False)
    username_ciphertext = Column(String, nullable=False)
    username_nonce = Column(String, nullable=False)

    email_hash = Column(String, unique=False, index=True, nullable=False)
    email_ciphertext = Column(String, nullable=False)
    email_nonce = Column(String, nullable=False)

    # Client-generated verifier material for login unlock (not plaintext password).
    password_salt = Column(Text, nullable=False)
    password_verifier = Column(Text, nullable=False)

    # Wrapped REK (Root Encryption Key) managed client-side.
    rek_ciphertext = Column(Text, nullable=False)
    rek_nonce = Column(Text, nullable=False)

    public_key = Column(Text, nullable=False)

    preferred_language = Column(String, nullable=True)

    is_admin = Column(Boolean, default=False, nullable=False)
    role = Column(String, default="editor", nullable=False)

    can_change_username = Column(Boolean, default=True, nullable=False)
    can_change_email = Column(Boolean, default=True, nullable=False)
    can_change_password = Column(Boolean, default=True, nullable=False)
    can_share = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)


class Credential(Base):
    __tablename__ = "credentials"

    credential_id = Column(String, primary_key=True, default=gen_uuid)
    owner_user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)

    title = Column(String, nullable=False)
    system_name = Column(String, nullable=False)

    # Encrypted credential payload blob and nonce.
    password_ciphertext = Column(Text, nullable=False)
    data_nonce = Column(Text, nullable=False)

    # Per-record key wrapped by owner REK.
    record_key_ciphertext = Column(Text, nullable=False)
    record_key_nonce = Column(Text, nullable=False)

    last_rotated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Share(Base):
    __tablename__ = "shares"
    __table_args__ = (
        Index("ix_shares_credential_from", "credential_id", "from_user_id"),
        Index("ix_shares_to_revoked", "to_user_id", "revoked"),
        Index("ix_shares_credential_to_revoked", "credential_id", "to_user_id", "revoked"),
    )

    share_id = Column(String, primary_key=True, default=gen_uuid)
    credential_id = Column(String, ForeignKey("credentials.credential_id"), nullable=False, index=True)

    from_user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)
    to_user_id = Column(String, ForeignKey("users.user_id"), nullable=False, index=True)

    # Recipient-specific wrapped copy of the record key.
    shared_record_key_cipher = Column(Text, nullable=False)
    shared_nonce = Column(Text, nullable=False)

    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    log_id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=True, index=True)
    action_type = Column(String, nullable=False)
    target_id = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
