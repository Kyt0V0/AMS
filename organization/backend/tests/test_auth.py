from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select, update

from ams.config import Settings
from ams.db import utcnow
from ams.main import create_app
from ams.models import Session, User
from fastapi.testclient import TestClient

from conftest import HEADERS, Api, b64, registration


def test_setup_requires_the_token_and_only_works_once(api: Api):
    assert api.http.get("/api/auth/status").json()["setup_required"] is True

    wrong = registration("admin", setup_token="x" * 32)
    assert api.http.post("/api/auth/setup", json=wrong).status_code == 403
    assert api.http.post("/api/auth/setup", json=registration("admin")).status_code == 403

    api.setup_admin()
    assert api.http.get("/api/auth/status").json()["setup_required"] is False
    again = registration("admin2", setup_token=api.app.state.setup_token)
    assert api.http.post("/api/auth/setup", json=again).status_code == 409
    assert not (api.app.state.ctx.settings.data_dir / "setup-token.txt").exists()


def test_login_sets_a_hardened_cookie_and_returns_key_material(api: Api):
    reg = api.setup_admin()
    res = api.login(reg)
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    assert cookie.startswith("__Host-ams_session=")
    for attribute in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"):
        assert attribute in cookie

    body = res.json()
    assert body["user"]["role"] == "admin"
    assert body["wrapped_vault_key"] == reg["wrapped_vault_key"]
    assert body["kdf"] == reg["kdf"]
    assert "auth_key" not in res.text and "auth_hash" not in res.text
    assert api.http.get("/api/auth/session").status_code == 200


def test_wrong_password_and_unknown_user_are_indistinguishable(api: Api):
    reg = api.setup_admin()
    wrong = api.http.post("/api/auth/login", json={"username": reg["username"], "auth_key": b64(32)})
    ghost = api.http.post("/api/auth/login", json={"username": "nobody", "auth_key": b64(32)})
    assert wrong.status_code == ghost.status_code == 401
    assert wrong.json() == ghost.json()


def test_prelogin_does_not_reveal_which_accounts_exist(api: Api):
    reg = api.setup_admin()
    real = api.http.post("/api/auth/prelogin", json={"username": "ADMIN"}).json()
    assert real == reg["kdf"]

    first = api.http.post("/api/auth/prelogin", json={"username": "ghost"}).json()
    second = api.http.post("/api/auth/prelogin", json={"username": "ghost"}).json()
    assert first == second and set(first) == set(real)
    assert first["salt"] != api.http.post("/api/auth/prelogin", json={"username": "ghost2"}).json()["salt"]


def test_repeated_failures_lock_the_account_temporarily(api: Api):
    reg = api.setup_admin()
    for _ in range(8):
        res = api.http.post("/api/auth/login", json={"username": reg["username"], "auth_key": b64(32)})
        assert res.status_code == 401
    locked = api.login(reg)
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0


def test_state_changing_requests_need_the_header_and_same_origin(admin: Api):
    bare = Api(admin.app)
    bare.http.headers.pop("X-AMS-Request")
    assert bare.http.post("/api/auth/prelogin", json={"username": "admin"}).status_code == 403

    cross = admin.http.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert cross.status_code == 403
    assert admin.http.get("/api/auth/session").status_code == 200

    same = admin.http.post("/api/auth/logout", headers={"Origin": "https://ams.test"})
    assert same.status_code == 200
    assert admin.http.get("/api/auth/session").status_code == 401


def test_security_headers_are_present(api: Api):
    res = api.http.get("/api/health")
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cache-control"] == "no-store"
    assert "max-age" in res.headers["strict-transport-security"]


def test_registration_needs_a_valid_single_use_invite(admin: Api):
    visitor = admin.other()
    assert visitor.http.post("/api/auth/register", json=registration("mallory")).status_code == 403
    bad = registration("mallory", invite_token="not-a-real-invite-token")
    assert visitor.http.post("/api/auth/register", json=bad).status_code == 403

    token = admin.invite("viewer")
    assert visitor.http.post("/api/auth/invite/check", json={"token": token}).json()["role"] == "viewer"
    reg = registration("vera", invite_token=token)
    assert visitor.http.post("/api/auth/register", json=reg).status_code == 201
    assert visitor.login(reg).json()["user"]["role"] == "viewer"

    reuse = registration("vera2", invite_token=token)
    assert visitor.http.post("/api/auth/register", json=reuse).status_code == 403


def test_duplicate_username_is_rejected_case_insensitively(admin: Api):
    admin.join(admin, "sam")
    dup = registration("SAM", invite_token=admin.invite())
    dup["email"] = "other@example.com"
    assert admin.other().http.post("/api/auth/register", json=dup).status_code == 409


def test_open_registration_can_be_enabled_by_policy(admin: Api):
    assert admin.http.put("/api/admin/policy", json={"open_registration": True}).status_code == 200
    visitor = admin.other()
    reg = registration("walkin")
    assert visitor.http.post("/api/auth/register", json=reg).status_code == 201
    assert visitor.login(reg).json()["user"]["role"] == "editor"


def test_invalid_public_key_and_weak_kdf_are_rejected(admin: Api):
    reg = registration("eve", invite_token=admin.invite())
    reg["public_key"] = b64(65)
    assert admin.other().http.post("/api/auth/register", json=reg).status_code == 422

    weak = registration("eve", invite_token=admin.invite())
    weak["kdf"]["memory_kib"] = 1024
    assert admin.other().http.post("/api/auth/register", json=weak).status_code == 422


def test_sessions_expire_when_idle_and_at_the_absolute_limit(admin: Api):
    factory = admin.app.state.ctx.session_factory
    with factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=16)))
        db.commit()
    assert admin.http.get("/api/auth/session").status_code == 401

    assert admin.login(admin.reg).status_code == 200
    with factory() as db:
        db.execute(update(Session).values(expires_at=utcnow() - timedelta(seconds=1)))
        db.commit()
    assert admin.http.get("/api/auth/session").status_code == 401


def test_password_change_needs_current_proof_and_signs_out_other_devices(admin: Api):
    laptop = admin.other()
    assert laptop.login(admin.reg).status_code == 200

    new = registration("ignored")
    change = {"kdf": new["kdf"], "auth_key": new["auth_key"], "wrapped_vault_key": new["wrapped_vault_key"]}
    denied = admin.http.put("/api/account/password", json={**change, "current_auth_key": b64(32)})
    assert denied.status_code == 403

    ok = admin.http.put("/api/account/password", json={**change, "current_auth_key": admin.reg["auth_key"]})
    assert ok.status_code == 200
    assert admin.http.get("/api/auth/session").status_code == 200
    assert laptop.http.get("/api/auth/session").status_code == 401

    assert admin.other().login(admin.reg).status_code == 401
    assert admin.other().login({"username": "admin", "auth_key": new["auth_key"]}).status_code == 200


def test_recovery_code_resets_the_password_and_is_replaced(admin: Api):
    reg = admin.reg
    visitor = admin.other()
    wrong = visitor.http.post(
        "/api/auth/recover/start", json={"username": "admin", "recovery_auth_key": b64(32)}
    )
    assert wrong.status_code == 401

    start = visitor.http.post(
        "/api/auth/recover/start", json={"username": "admin", "recovery_auth_key": reg["recovery_auth_key"]}
    )
    assert start.json()["recovery_wrapped_vault_key"] == reg["recovery_wrapped_vault_key"]

    new = registration("ignored")
    finish = {
        "username": "admin",
        "recovery_auth_key": reg["recovery_auth_key"],
        "kdf": new["kdf"],
        "auth_key": new["auth_key"],
        "wrapped_vault_key": new["wrapped_vault_key"],
        "new_recovery": {
            "recovery_auth_key": new["recovery_auth_key"],
            "recovery_wrapped_vault_key": new["recovery_wrapped_vault_key"],
        },
    }
    assert visitor.http.post("/api/auth/recover/finish", json=finish).status_code == 200
    assert admin.http.get("/api/auth/session").status_code == 401
    assert visitor.login({"username": "admin", "auth_key": new["auth_key"]}).status_code == 200
    assert admin.other().http.post("/api/auth/recover/finish", json=finish).status_code == 401


def test_identity_is_encrypted_at_rest(admin: Api):
    with admin.app.state.ctx.session_factory() as db:
        user = db.scalar(select(User))
    stored = " ".join([user.username_enc, user.username_lookup, user.email_enc, user.email_lookup, user.auth_hash])
    assert "admin" not in stored and "example.com" not in stored
    assert user.auth_hash.startswith("$argon2id$")
    assert admin.reg["auth_key"] not in stored


def test_profile_update_and_lock(admin: Api):
    user, _ = admin.join(admin, "pat")
    assert user.http.patch("/api/account/profile", json={"username": "patricia"}).json()["username"] == "patricia"
    assert user.http.patch("/api/account/profile", json={"username": "admin"}).status_code == 409

    admin.http.patch(f"/api/admin/users/{user.me()['id']}", json={"can_edit_profile": False})
    assert user.http.patch("/api/account/profile", json={"email": "new@example.com"}).status_code == 403
    assert user.http.patch("/api/account/profile", json={"preferred_language": "vi"}).status_code == 200


def test_session_list_and_remote_sign_out(admin: Api):
    phone = admin.other()
    phone.login(admin.reg)
    sessions = admin.http.get("/api/account/sessions").json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    other = next(s for s in sessions if not s["current"])
    assert admin.http.delete(f"/api/account/sessions/{other['id']}").status_code == 200
    assert phone.http.get("/api/auth/session").status_code == 401


def test_account_deletion_needs_password_and_keeps_one_admin(admin: Api):
    denied = admin.http.post("/api/account/delete", json={"current_auth_key": admin.reg["auth_key"]})
    assert denied.status_code == 409

    user, reg = admin.join(admin, "temp")
    assert user.http.post("/api/account/delete", json={"current_auth_key": b64(32)}).status_code == 403
    assert user.http.post("/api/account/delete", json={"current_auth_key": reg["auth_key"]}).status_code == 200
    assert admin.other().login(reg).status_code == 401


def test_setup_token_is_only_handed_to_a_browser_on_the_server_itself(api: Api):
    token = api.app.state.setup_token

    def ask(base_url: str, peer: str, **headers):
        client = TestClient(api.app, base_url=base_url, headers=HEADERS, client=(peer, 50000))
        return client.get("/api/auth/setup-token", headers=headers)

    assert ask("http://localhost:8000", "127.0.0.1").json() == {"token": token}
    assert ask("http://127.0.0.1:8000", "127.0.0.1").json() == {"token": token}
    assert ask("http://[::1]:8000", "::1").json() == {"token": token}

    assert ask("http://localhost:8000", "192.168.1.50").status_code == 404
    assert ask("http://ams.office.lan:8000", "127.0.0.1").status_code == 404
    assert ask("http://localhost:8000", "127.0.0.1", **{"X-Forwarded-For": "203.0.113.9"}).status_code == 404
    assert api.http.get("/api/auth/setup-token").status_code == 404

    api.setup_admin()
    assert ask("http://localhost:8000", "127.0.0.1").status_code == 404


def test_streamed_bodies_cannot_exceed_the_size_limit(api):
    def chunks():
        for _ in range(40):
            yield b" " * 65536

    res = api.http.post("/api/auth/prelogin", content=chunks(), headers={"content-type": "application/json"})
    assert "content-length" not in res.request.headers
    assert res.status_code == 413
    assert res.headers["content-security-policy"]

    small = api.http.post("/api/auth/prelogin", content=iter([b'{"username": "nobody"}']), headers={"content-type": "application/json"})
    assert small.status_code == 200


def test_only_local_host_names_are_accepted_by_default(tmp_path):
    settings = Settings.from_env({"AMS_DATA_DIR": str(tmp_path), "AMS_STATIC_DIR": str(tmp_path / "no-client")})
    application = create_app(settings)
    try:
        for host, expected in (("localhost:8000", 200), ("127.0.0.1", 200), ("evil.example", 400)):
            client = TestClient(application, base_url=f"http://{host}")
            assert client.get("/api/auth/status").status_code == expected, host
    finally:
        application.state.engine.dispose()


def test_a_proxied_or_network_server_uses_the_configured_host_names(tmp_path):
    base = {"AMS_DATA_DIR": str(tmp_path), "AMS_STATIC_DIR": str(tmp_path / "no-client")}
    proxied = create_app(Settings.from_env({**base, "AMS_BEHIND_PROXY": "1"}))
    listed = create_app(Settings.from_env({**base, "AMS_HOST": "0.0.0.0", "AMS_ALLOWED_HOSTS": "ams.example.lan"}))
    try:
        assert TestClient(proxied, base_url="https://vault.example.org").get("/api/auth/status").status_code == 200
        assert TestClient(listed, base_url="https://ams.example.lan").get("/api/auth/status").status_code == 200
        assert TestClient(listed, base_url="https://evil.example").get("/api/auth/status").status_code == 400
    finally:
        proxied.state.engine.dispose()
        listed.state.engine.dispose()
