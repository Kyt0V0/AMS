import os

from sqlalchemy.orm import Session

from .field_crypto import lookup_hash
from .models import User


def ensure_first_admin(db: Session):
    username = os.getenv("FIRST_ADMIN_USERNAME")
    if not username:
        return
    u_hash = lookup_hash(username)
    u = db.query(User).filter(User.username_hash == u_hash).first()
    if not u:
        return
    if not u.is_admin:
        u.is_admin = True
        db.commit()
