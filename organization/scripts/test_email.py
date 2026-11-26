#!/usr/bin/env python3

from __future__ import annotations

import hmac
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

try:
    from ams.config import Settings
    from ams.mail import MailError, create_mailer
except ModuleNotFoundError:
    sys.exit("Run this with the AMS environment:  backend/.venv/bin/python scripts/test_email.py you@example.com")

USAGE = """Check the e-mail settings: send a verification code to an address and verify it.

    python3 scripts/test_email.py you@example.com

Uses the AMS_SMTP_* settings from the environment or the .env file, exactly as the
server does. Run it before turning on two-step sign-in, so you know codes arrive.
"""


def main() -> int:
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        print(USAGE, file=sys.stderr)
        return 2
    address = sys.argv[1]
    settings = Settings.from_env()
    mailer = create_mailer(settings)
    if not mailer.enabled:
        print("E-mail is not configured. Set AMS_SMTP_HOST (and the other AMS_SMTP_* values) in .env first.", file=sys.stderr)
        return 1

    code = f"{secrets.randbelow(1_000_000):06d}"
    target = settings.smtp_host or "the server console (AMS_EMAIL_DEBUG)"
    print(f"Sending a test code to {address} through {target} ...")
    try:
        mailer.send(
            address,
            "AMS e-mail test",
            f"Your verification code is: {code}\n\nThis is a test of the AMS e-mail settings. No account was changed.\n",
        )
    except MailError as error:
        cause = error.__cause__
        print(f"Failed: {error}" + (f" ({cause.__class__.__name__}: {cause})" if cause else ""), file=sys.stderr)
        return 1

    entered = input("Sent. Enter the 6-digit code from the e-mail: ").strip()
    if hmac.compare_digest(entered, code):
        print("Correct. E-mail delivery works; two-step sign-in can be turned on.")
        return 0
    print("That code does not match.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
