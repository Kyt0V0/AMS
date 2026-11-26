from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from .core import AppContext, enforce_limit, get_policy
from .db import utcnow
from .mail import MailError
from .models import EmailCode, User, new_id
from .security import hash_token, new_token

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5

LOGIN = "login"
ENABLE = "enable"
EMAIL_CHANGE = "email_change"

_SUBJECTS = {
    LOGIN: "Your AMS sign-in code",
    ENABLE: "Confirm two-step sign-in for AMS",
    EMAIL_CHANGE: "Confirm your new AMS e-mail address",
}
_REASONS = {
    LOGIN: "Someone entered the correct master password for your AMS account and needs this code to finish signing in.",
    ENABLE: "Use this code to turn on two-step sign-in for your AMS account.",
    EMAIL_CHANGE: "Use this code to confirm this address for your AMS account.",
}


def _code_hash(row_id: str, code: str) -> str:
    return hashlib.sha256(f"{row_id}:{code}".encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def two_factor_required(db: DbSession, user: User) -> bool:
    return bool(user.two_factor_enabled or get_policy(db)["require_two_factor"])


def issue(ctx: AppContext, db: DbSession, user: User, purpose: str, new_email: str | None = None) -> tuple[str, str]:
    if not ctx.mailer.enabled:
        raise HTTPException(status_code=503, detail="E-mail is not set up on this server. Contact an administrator.")
    enforce_limit(ctx.limits.mail_user, user.id)
    ctx.limits.mail_user.hit(user.id)

    address = new_email or ctx.keys.decrypt(user.email_enc)
    code = f"{secrets.randbelow(1_000_000):06d}"
    ticket = new_token()
    row_id = new_id()
    db.execute(delete(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose))
    db.execute(delete(EmailCode).where(EmailCode.expires_at < utcnow()))
    db.add(
        EmailCode(
            id=row_id,
            user_id=user.id,
            purpose=purpose,
            ticket_hash=hash_token(ticket),
            code_hash=_code_hash(row_id, code),
            target_enc=ctx.keys.encrypt(new_email) if new_email else None,
            expires_at=utcnow() + CODE_TTL,
        )
    )
    body = (
        f"Your verification code is: {code}\n\n"
        f"{_REASONS[purpose]}\n"
        f"The code expires in {int(CODE_TTL.total_seconds() // 60)} minutes and can be used once.\n\n"
        "If this was not you, do not share the code. If you did not try to sign in, "
        "your master password may be known to someone else: change it.\n"
    )
    try:
        ctx.mailer.send(address, _SUBJECTS[purpose], body)
    except MailError:
        db.rollback()
        raise HTTPException(
            status_code=502, detail="The verification e-mail could not be sent. Try again later."
        ) from None
    return ticket, mask_email(address)


def find(db: DbSession, purpose: str, *, ticket: str | None = None, user_id: str | None = None) -> EmailCode | None:
    query = select(EmailCode).where(EmailCode.purpose == purpose, EmailCode.expires_at > utcnow())
    if ticket is not None:
        query = query.where(EmailCode.ticket_hash == hash_token(ticket))
    else:
        query = query.where(EmailCode.user_id == user_id)
    return db.scalar(query)


def redeem(db: DbSession, row: EmailCode | None, code: str) -> EmailCode:
    if row is None:
        raise HTTPException(status_code=401, detail="This code has expired. Request a new one.")
    if hmac.compare_digest(row.code_hash, _code_hash(row.id, code)):
        db.delete(row)
        return row

    row.attempts += 1
    exhausted = row.attempts >= MAX_ATTEMPTS
    if exhausted:
        db.delete(row)
    db.commit()
    if exhausted:
        raise HTTPException(status_code=401, detail="Too many incorrect codes. Start again to get a new one.")
    raise HTTPException(status_code=401, detail="That code is not correct.")
