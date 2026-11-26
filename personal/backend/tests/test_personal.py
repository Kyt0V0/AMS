from __future__ import annotations

import inspect
from datetime import timedelta

from sqlalchemy import select, update

import ams.__main__ as launcher
from ams import config
from ams.db import utcnow
from ams.models import Session, User
from conftest import Api, b64, vault_material


def test_the_server_can_only_listen_on_this_computer():
    assert config.HOST == "127.0.0.1"
    assert not hasattr(config.Settings, "host")
    assert "host=HOST" in inspect.getsource(launcher.main)
    assert config.Settings.from_env({"AMS_HOST": "0.0.0.0", "AMS_DATA_DIR": "/tmp/x"}).port == 8100


def test_requests_under_any_other_host_name_are_refused(app):
    assert Api(app, "http://localhost:8100").http.get("/api/health").status_code == 200
    assert Api(app, "http://127.0.0.1:8100").http.get("/api/health").status_code == 200
    assert Api(app, "http://192.168.1.20:8100").http.get("/api/health").status_code == 400
    assert Api(app, "http://evil.example").http.get("/api/health").status_code == 400


def test_the_vault_is_created_once_and_there_is_only_ever_one_owner(api: Api):
    status = api.http.get("/api/auth/status").json()
    assert status["setup_required"] is True and status["kdf"] is None

    material = vault_material()
    assert api.http.post("/api/auth/setup", json=material).status_code == 201
    assert api.http.post("/api/auth/setup", json=vault_material(name="Intruder")).status_code == 409

    status = api.http.get("/api/auth/status").json()
    assert status["setup_required"] is False and status["kdf"] == material["kdf"] and status["name"] == "Sam"
    with api.app.state.ctx.session_factory() as db:
        assert len(db.scalars(select(User)).all()) == 1


def test_there_are_no_multi_user_or_network_features(owner: Api):
    for path in ("/api/users", "/api/admin/users", "/api/admin/invites", "/api/auth/register", "/api/auth/setup-token"):
        assert owner.http.get(path).status_code == 404
    assert owner.http.post("/api/auth/register", json={}).status_code == 404
    entry_id = owner.add_entry()
    assert owner.http.post(f"/api/credentials/{entry_id}/shares", json={}).status_code == 404


def test_unlocking_needs_the_right_password_and_sets_a_private_cookie(api: Api):
    material = vault_material()
    api.http.post("/api/auth/setup", json=material)
    assert api.http.post("/api/auth/login", json={"auth_key": b64(32)}).status_code == 401
    assert api.http.get("/api/credentials").status_code == 401

    res = api.login(material)
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    assert cookie.startswith("ams_personal_session=") and "HttpOnly" in cookie and "SameSite=strict" in cookie
    body = res.json()
    assert body["wrapped_vault_key"] == material["wrapped_vault_key"] and body["user"]["name"] == "Sam"
    assert "auth_hash" not in res.text and material["auth_key"] not in res.text


def test_repeated_wrong_passwords_are_throttled(api: Api):
    material = vault_material()
    api.http.post("/api/auth/setup", json=material)
    for _ in range(8):
        assert api.http.post("/api/auth/login", json={"auth_key": b64(32)}).status_code == 401
    locked = api.login(material)
    assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0


def test_other_web_pages_cannot_drive_the_vault(owner: Api):
    bare = owner.other()
    bare.http.headers.pop("X-AMS-Request")
    assert bare.http.post("/api/auth/login", json={"auth_key": b64(32)}).status_code == 403
    cross = owner.http.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert cross.status_code == 403
    assert owner.http.get("/api/auth/session").status_code == 200
    headers = owner.http.get("/api/health").headers
    assert "frame-ancestors 'none'" in headers["content-security-policy"] and headers["cache-control"] == "no-store"


def test_entries_can_be_added_changed_rotated_and_deleted(owner: Api):
    entry_id = owner.add_entry()
    listed = owner.http.get("/api/credentials").json()
    assert [c["id"] for c in listed] == [entry_id] and listed[0]["version"] == 1

    assert owner.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(90), "version": 1}).json() == {"version": 2}
    stale = owner.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(90), "version": 1})
    assert stale.status_code == 409

    rotate = {"ciphertext": b64(120), "wrapped_key": b64(60), "version": 2}
    assert owner.http.post(f"/api/credentials/{entry_id}/rotate", json=rotate).json()["version"] == 3
    assert owner.http.get("/api/credentials").json()[0]["wrapped_key"] == rotate["wrapped_key"]

    assert owner.http.delete(f"/api/credentials/{entry_id}").status_code == 200
    assert owner.http.get("/api/credentials").json() == []
    assert owner.http.delete(f"/api/credentials/{entry_id}").status_code == 404
    duplicate = {"id": owner.add_entry(), "ciphertext": b64(120), "wrapped_key": b64(60)}
    assert owner.http.post("/api/credentials", json=duplicate).status_code == 409


def test_sessions_expire_when_idle(owner: Api):
    with owner.app.state.ctx.session_factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=16)))
        db.commit()
    assert owner.http.get("/api/auth/session").status_code == 401


def test_password_change_needs_the_current_password(owner: Api):
    second_window = owner.other()
    second_window.login(owner.material)
    new = vault_material()
    change = {"kdf": new["kdf"], "auth_key": new["auth_key"], "wrapped_vault_key": new["wrapped_vault_key"]}
    assert owner.http.put("/api/account/password", json={**change, "current_auth_key": b64(32)}).status_code == 403
    ok = owner.http.put("/api/account/password", json={**change, "current_auth_key": owner.material["auth_key"]})
    assert ok.status_code == 200
    assert second_window.http.get("/api/auth/session").status_code == 401
    assert owner.other().login(owner.material).status_code == 401
    assert owner.other().login(new).status_code == 200


def test_recovery_code_resets_the_password_and_is_replaced(owner: Api):
    old = owner.material
    visitor = owner.other()
    assert visitor.http.post("/api/auth/recover/start", json={"recovery_auth_key": b64(32)}).status_code == 401
    start = visitor.http.post("/api/auth/recover/start", json={"recovery_auth_key": old["recovery_auth_key"]})
    assert start.json()["recovery_wrapped_vault_key"] == old["recovery_wrapped_vault_key"]

    new = vault_material()
    finish = {
        "recovery_auth_key": old["recovery_auth_key"],
        "kdf": new["kdf"],
        "auth_key": new["auth_key"],
        "wrapped_vault_key": new["wrapped_vault_key"],
        "new_recovery": {
            "recovery_auth_key": new["recovery_auth_key"],
            "recovery_wrapped_vault_key": new["recovery_wrapped_vault_key"],
        },
    }
    assert visitor.http.post("/api/auth/recover/finish", json=finish).status_code == 200
    assert owner.http.get("/api/auth/session").status_code == 401
    assert visitor.login(new).status_code == 200
    assert owner.other().http.post("/api/auth/recover/finish", json=finish).status_code == 401


def test_preferences_profile_and_activity(owner: Api):
    assert owner.http.patch("/api/account/profile", json={"name": "Samira"}).json() == {"name": "Samira"}
    assert owner.http.put("/api/account/preferences", json={"kdf_memory_kib": 1024}).status_code == 422
    saved = owner.http.put("/api/account/preferences", json={"vault_timeout_minutes": 3}).json()
    assert saved["vault_timeout_minutes"] == 3 and saved["password_max_age_days"] == 180
    assert owner.http.get("/api/auth/session").json()["policy"]["vault_timeout_minutes"] == 3

    owner.other().http.post("/api/auth/login", json={"auth_key": b64(32)})
    actions = [row["action"] for row in owner.http.get("/api/account/activity").json()]
    assert actions[:3] == ["unlock.failed", "unlock.ok", "vault.created"]


def test_deleting_the_vault_erases_everything(owner: Api):
    owner.add_entry()
    assert owner.http.post("/api/account/delete", json={"current_auth_key": b64(32)}).status_code == 403
    ok = owner.http.post("/api/account/delete", json={"current_auth_key": owner.material["auth_key"]})
    assert ok.status_code == 200
    assert owner.http.get("/api/auth/status").json()["setup_required"] is True
    assert owner.http.get("/api/credentials").status_code == 401


def test_streamed_bodies_cannot_exceed_the_size_limit(api):
    def chunks():
        for _ in range(40):
            yield b" " * 65536

    res = api.http.post("/api/auth/login", content=chunks(), headers={"content-type": "application/json"})
    assert "content-length" not in res.request.headers
    assert res.status_code == 413
