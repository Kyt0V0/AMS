from __future__ import annotations

from datetime import timedelta

from sqlalchemy import update

from ams.db import utcnow
from ams.models import EmailCode
from ams.ratelimit import RateLimiter
from conftest import Api, FakeMailer, b64


def enable(user: Api, mail: FakeMailer) -> None:
    assert user.http.post("/api/account/two-factor/start").status_code == 200
    assert user.http.post("/api/account/two-factor/enable", json={"code": mail.last_code()}).status_code == 200


def wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def test_two_factor_is_unavailable_without_email(admin: Api):
    assert admin.http.get("/api/auth/status").json()["mail_enabled"] is False
    assert admin.http.post("/api/account/two-factor/start").status_code == 503
    assert admin.http.put("/api/admin/policy", json={"require_two_factor": True}).status_code == 409


def test_enabling_needs_a_code_sent_to_the_account_address(admin: Api, mail: FakeMailer):
    start = admin.http.post("/api/account/two-factor/start")
    assert start.json() == {"email_hint": "a***@example.com"}
    to, subject, body = mail.sent[-1]
    assert to == "admin@example.com" and "two-step" in subject

    code = mail.last_code()
    assert admin.http.post("/api/account/two-factor/enable", json={"code": wrong(code)}).status_code == 401
    assert admin.me()["two_factor_enabled"] is False
    assert admin.http.post("/api/account/two-factor/enable", json={"code": code}).status_code == 200
    assert admin.me()["two_factor_enabled"] is True
    assert admin.http.post("/api/account/two-factor/enable", json={"code": code}).status_code == 401


def test_sign_in_needs_the_emailed_code(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    browser = admin.other()

    first = browser.login(admin.reg)
    assert first.status_code == 200
    body = first.json()
    assert body["two_factor_required"] is True and body["email_hint"] == "a***@example.com"
    assert "set-cookie" not in first.headers and "wrapped_vault_key" not in body
    assert browser.http.get("/api/auth/session").status_code == 401

    code = mail.last_code()
    bad = browser.http.post("/api/auth/login/verify", json={"ticket": body["ticket"], "code": wrong(code)})
    assert bad.status_code == 401
    forged = browser.http.post("/api/auth/login/verify", json={"ticket": "x" * 43, "code": code})
    assert forged.status_code == 401

    done = browser.http.post("/api/auth/login/verify", json={"ticket": body["ticket"], "code": code})
    assert done.status_code == 200
    assert done.json()["wrapped_vault_key"] == admin.reg["wrapped_vault_key"]
    assert "__Host-ams_session=" in done.headers["set-cookie"]
    assert browser.http.get("/api/auth/session").status_code == 200

    replay = admin.other().http.post("/api/auth/login/verify", json={"ticket": body["ticket"], "code": code})
    assert replay.status_code == 401


def test_a_wrong_password_never_sends_a_code(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    before = len(mail.sent)
    res = admin.other().http.post("/api/auth/login", json={"username": "admin", "auth_key": b64(32)})
    assert res.status_code == 401 and len(mail.sent) == before


def test_codes_expire_and_allow_only_a_few_guesses(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    browser = admin.other()

    ticket = browser.login(admin.reg).json()["ticket"]
    code = mail.last_code()
    with admin.app.state.ctx.session_factory() as db:
        db.execute(update(EmailCode).values(expires_at=utcnow() - timedelta(seconds=1)))
        db.commit()
    assert browser.http.post("/api/auth/login/verify", json={"ticket": ticket, "code": code}).status_code == 401

    ticket = browser.login(admin.reg).json()["ticket"]
    code = mail.last_code()
    for _ in range(5):
        res = browser.http.post("/api/auth/login/verify", json={"ticket": ticket, "code": wrong(code)})
        assert res.status_code == 401
    assert browser.http.post("/api/auth/login/verify", json={"ticket": ticket, "code": code}).status_code == 401


def test_resending_replaces_the_code_and_ticket(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    browser = admin.other()
    old_ticket = browser.login(admin.reg).json()["ticket"]
    old_code = mail.last_code()

    new_ticket = browser.http.post("/api/auth/login/resend", json={"ticket": old_ticket}).json()["ticket"]
    new_code = mail.last_code()
    assert new_ticket != old_ticket
    stale = browser.http.post("/api/auth/login/verify", json={"ticket": old_ticket, "code": old_code})
    assert stale.status_code == 401
    assert browser.http.post("/api/auth/login/verify", json={"ticket": new_ticket, "code": new_code}).status_code == 200
    assert browser.http.post("/api/auth/login/resend", json={"ticket": "y" * 43}).status_code == 401


def test_verification_emails_are_rate_limited(admin: Api, mail: FakeMailer):
    for _ in range(6):
        assert admin.http.post("/api/account/two-factor/start").status_code == 200
    assert admin.http.post("/api/account/two-factor/start").status_code == 429


def test_sign_in_fails_safely_when_the_email_cannot_be_sent(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    mail.fail = True
    browser = admin.other()
    assert browser.login(admin.reg).status_code == 502
    assert browser.http.get("/api/auth/session").status_code == 401


def test_turning_it_off_needs_the_password(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    assert admin.http.post("/api/account/two-factor/disable", json={"current_auth_key": b64(32)}).status_code == 403
    ok = admin.http.post("/api/account/two-factor/disable", json={"current_auth_key": admin.reg["auth_key"]})
    assert ok.status_code == 200
    assert "wrapped_vault_key" in admin.other().login(admin.reg).json()


def test_policy_can_require_it_for_everyone(admin: Api, mail: FakeMailer):
    user, reg = admin.join(admin, "nina")
    assert admin.http.put("/api/admin/policy", json={"require_two_factor": True}).status_code == 409
    enable(admin, mail)
    assert admin.http.put("/api/admin/policy", json={"require_two_factor": True}).status_code == 200

    challenge = user.other().login(reg).json()
    assert challenge["two_factor_required"] is True
    assert mail.sent[-1][0] == "nina@example.com"

    editor_attempt = user.http.put("/api/admin/policy", json={"require_two_factor": False})
    assert editor_attempt.status_code == 403


def test_admin_can_switch_a_users_two_factor_off_but_not_on(admin: Api, mail: FakeMailer):
    user, reg = admin.join(admin, "omar")
    enable(user, mail)
    uid = user.me()["id"]
    assert admin.http.patch(f"/api/admin/users/{uid}", json={"two_factor_enabled": True}).status_code == 422
    assert admin.http.patch(f"/api/admin/users/{uid}", json={"two_factor_enabled": False}).status_code == 200
    assert "wrapped_vault_key" in user.other().login(reg).json()


def test_a_new_email_address_must_be_confirmed(admin: Api, mail: FakeMailer):
    user, reg = admin.join(admin, "pia")
    key = {"current_auth_key": reg["auth_key"]}
    assert user.http.patch("/api/account/profile", json={"email": "new@example.com", **key}).status_code == 409
    assert user.me()["email"] == "pia@example.com"

    assert user.http.post("/api/account/email/start", json={"email": "admin@example.com", **key}).status_code == 409
    assert user.http.post("/api/account/email/start", json={"email": "new@example.com"}).status_code == 422
    stolen = user.http.post("/api/account/email/start", json={"email": "new@example.com", "current_auth_key": b64(32)})
    assert stolen.status_code == 403 and not mail.sent
    start = user.http.post("/api/account/email/start", json={"email": "new@example.com", **key})
    assert start.json() == {"email_hint": "n***@example.com"}
    assert mail.sent[-1][0] == "new@example.com"

    code = mail.last_code()
    assert user.http.post("/api/account/email/confirm", json={"code": wrong(code)}).status_code == 401
    assert user.me()["email"] == "pia@example.com"
    assert user.http.post("/api/account/email/confirm", json={"code": code}).json() == {"email": "new@example.com"}
    assert user.me()["email"] == "new@example.com"
    assert mail.sent[-1][0] == "pia@example.com" and "n***@example.com" in mail.sent[-1][2]


def test_without_mail_an_email_change_still_needs_the_master_password(admin: Api):
    user, reg = admin.join(admin, "quin")
    assert user.http.patch("/api/account/profile", json={"email": "new@example.com"}).status_code == 403
    wrong_key = {"email": "new@example.com", "current_auth_key": b64(32)}
    assert user.http.patch("/api/account/profile", json=wrong_key).status_code == 403
    assert user.me()["email"] == "quin@example.com"
    right_key = {"email": "new@example.com", "current_auth_key": reg["auth_key"]}
    assert user.http.patch("/api/account/profile", json=right_key).status_code == 200
    assert user.me()["email"] == "new@example.com"


def test_codes_for_one_purpose_cannot_be_used_for_another(admin: Api, mail: FakeMailer):
    start = {"email": "other@example.com", "current_auth_key": admin.reg["auth_key"]}
    assert admin.http.post("/api/account/email/start", json=start).status_code == 200
    code = mail.last_code()
    assert admin.http.post("/api/account/two-factor/enable", json={"code": code}).status_code == 401
    assert admin.me()["two_factor_enabled"] is False


def test_codes_are_stored_only_as_hashes(admin: Api, mail: FakeMailer):
    admin.http.post("/api/account/two-factor/start")
    code = mail.last_code()
    with admin.app.state.ctx.session_factory() as db:
        row = db.query(EmailCode).one()
    assert code not in (row.code_hash + row.ticket_hash) and len(row.code_hash) == 64


def test_repeated_wrong_codes_lock_code_sign_in_for_a_day(admin: Api, mail: FakeMailer):
    enable(admin, mail)
    limits = admin.app.state.ctx.limits
    limits.login_user = limits.login_ip = limits.mail_user = RateLimiter(1000, 60)
    browser = admin.other()
    for _ in range(10):
        ticket = browser.login(admin.reg).json()["ticket"]
        bad = browser.http.post("/api/auth/login/verify", json={"ticket": ticket, "code": wrong(mail.last_code())})
        assert bad.status_code == 401

    sent = len(mail.sent)
    locked = browser.login(admin.reg)
    assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 3600
    assert len(mail.sent) == sent
    assert admin.http.get("/api/auth/session").status_code == 200
