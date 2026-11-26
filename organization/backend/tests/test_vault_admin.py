from __future__ import annotations

import uuid

from conftest import Api, b64


def entry(api: Api, entry_id: str) -> dict | None:
    return next((c for c in api.http.get("/api/credentials").json() if c["id"] == entry_id), None)


def share(owner: Api, entry_id: str, recipient: Api, key: str | None = None):
    return owner.http.post(
        f"/api/credentials/{entry_id}/shares",
        json={"recipient_id": recipient.me()["id"], "wrapped_key": key or b64(60)},
    )


def test_entries_are_private_to_their_owner(admin: Api):
    alice, _ = admin.join(admin, "alice")
    bob, _ = admin.join(admin, "bob")
    entry_id = alice.add_entry()

    assert entry(alice, entry_id)["is_owner"] is True
    assert entry(bob, entry_id) is None
    assert entry(admin, entry_id) is None

    update = {"ciphertext": b64(100), "version": 1}
    for intruder in (bob, admin):
        assert intruder.http.put(f"/api/credentials/{entry_id}", json=update).status_code == 404
        assert intruder.http.delete(f"/api/credentials/{entry_id}").status_code == 404
        assert intruder.http.get(f"/api/credentials/{entry_id}/shares").status_code == 404
    assert alice.http.get("/api/credentials").status_code == 200
    assert admin.other().http.get("/api/credentials").status_code == 401


def test_updates_use_optimistic_versioning(admin: Api):
    entry_id = admin.add_entry()
    first = admin.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(100), "version": 1})
    assert first.json()["version"] == 2
    stale = admin.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(100), "version": 1})
    assert stale.status_code == 409
    assert entry(admin, entry_id)["version"] == 2


def test_duplicate_entry_id_is_rejected(admin: Api):
    entry_id = admin.add_entry()
    body = {"id": entry_id, "ciphertext": b64(120), "wrapped_key": b64(60)}
    assert admin.http.post("/api/credentials", json=body).status_code == 409


def test_sharing_gives_the_recipient_their_own_key_copy(admin: Api):
    alice, _ = admin.join(admin, "alice")
    bob, _ = admin.join(admin, "bob")
    entry_id = alice.add_entry()
    recipient_key = b64(60)

    assert share(alice, entry_id, bob, recipient_key).status_code == 201
    seen = entry(bob, entry_id)
    assert seen["is_owner"] is False
    assert seen["wrapped_key"] == recipient_key
    assert seen["owner_username"] == "alice"
    assert seen["owner_public_key"] == alice.http.get("/api/auth/session").json()["public_key"]
    assert entry(alice, entry_id)["shared_with"] == 1
    assert [s["username"] for s in alice.http.get(f"/api/credentials/{entry_id}/shares").json()] == ["bob"]

    assert bob.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(90), "version": 1}).status_code == 404
    assert bob.http.delete(f"/api/credentials/{entry_id}").status_code == 404
    assert share(bob, entry_id, admin).status_code == 404
    assert share(alice, entry_id, alice).status_code == 400


def test_revoking_rotates_the_key_and_removes_access(admin: Api):
    alice, _ = admin.join(admin, "alice")
    bob, _ = admin.join(admin, "bob")
    carol, _ = admin.join(admin, "carol")
    entry_id = alice.add_entry()
    share(alice, entry_id, bob)
    share(alice, entry_id, carol)

    new_carol_key = b64(60)
    rotate = {
        "ciphertext": b64(120),
        "wrapped_key": b64(60),
        "version": 1,
        "shares": [{"recipient_id": carol.me()["id"], "wrapped_key": new_carol_key}],
    }
    assert alice.http.post(f"/api/credentials/{entry_id}/rotate", json=rotate).json()["version"] == 2
    assert entry(bob, entry_id) is None
    assert entry(carol, entry_id)["wrapped_key"] == new_carol_key
    assert entry(alice, entry_id)["wrapped_key"] == rotate["wrapped_key"]

    sneaky = {**rotate, "version": 2, "shares": [{"recipient_id": bob.me()["id"], "wrapped_key": b64(60)}]}
    assert alice.http.post(f"/api/credentials/{entry_id}/rotate", json=sneaky).status_code == 400
    assert entry(alice, entry_id)["version"] == 2
    assert alice.http.post(f"/api/credentials/{entry_id}/rotate", json=rotate).status_code == 409


def test_recipient_can_leave_a_share(admin: Api):
    bob, _ = admin.join(admin, "bob")
    entry_id = admin.add_entry()
    share(admin, entry_id, bob)
    assert bob.http.delete(f"/api/credentials/{entry_id}/shares/me").status_code == 200
    assert entry(bob, entry_id) is None
    assert bob.http.delete(f"/api/credentials/{entry_id}/shares/me").status_code == 404


def test_roles_and_sharing_permission_are_enforced(admin: Api):
    viewer, _ = admin.join(admin, "vic", role="viewer")
    editor, _ = admin.join(admin, "eddy")
    body = {"id": str(uuid.uuid4()), "ciphertext": b64(120), "wrapped_key": b64(60)}
    assert viewer.http.post("/api/credentials", json=body).status_code == 403
    assert viewer.http.get("/api/users").status_code == 403

    entry_id = editor.add_entry()
    assert share(editor, entry_id, viewer).status_code == 201
    assert entry(viewer, entry_id) is not None

    admin.http.patch(f"/api/admin/users/{editor.me()['id']}", json={"can_share": False})
    assert share(editor, entry_id, admin).status_code == 403

    names = [u["username"] for u in editor.http.get("/api/users").json()]
    assert names == ["admin", "vic"]


def test_admin_endpoints_are_admin_only(admin: Api):
    editor, _ = admin.join(admin, "eddy")
    for path in ("overview", "users", "invites", "policy", "audit"):
        assert editor.http.get(f"/api/admin/{path}").status_code == 403
        assert admin.http.get(f"/api/admin/{path}").status_code == 200
    assert editor.http.put("/api/admin/policy", json={"open_registration": True}).status_code == 403
    assert editor.http.post("/api/admin/invites", json={}).status_code == 403


def test_disabling_a_user_signs_them_out_and_blocks_login(admin: Api):
    user, reg = admin.join(admin, "dana")
    uid = user.me()["id"]
    assert admin.http.patch(f"/api/admin/users/{uid}", json={"is_active": False}).status_code == 200
    assert user.http.get("/api/auth/session").status_code == 401
    assert user.login(reg).status_code == 403

    admin.http.patch(f"/api/admin/users/{uid}", json={"is_active": True})
    assert user.login(reg).status_code == 200


def test_the_last_administrator_is_protected(admin: Api):
    me = admin.me()["id"]
    assert admin.http.patch(f"/api/admin/users/{me}", json={"role": "editor"}).status_code == 409
    assert admin.http.patch(f"/api/admin/users/{me}", json={"is_active": False}).status_code == 409
    assert admin.http.delete(f"/api/admin/users/{me}").status_code == 409

    second, _ = admin.join(admin, "root2", role="admin")
    assert second.http.patch(f"/api/admin/users/{me}", json={"role": "editor"}).status_code == 200
    assert second.http.patch(f"/api/admin/users/{second.me()['id']}", json={"role": "viewer"}).status_code == 409
    assert admin.http.get("/api/admin/users").status_code == 403


def test_deleting_a_user_removes_their_entries_and_shares(admin: Api):
    alice, reg = admin.join(admin, "alice")
    bob, _ = admin.join(admin, "bob")
    entry_id = alice.add_entry()
    share(alice, entry_id, bob)
    mine = admin.add_entry()
    share(admin, mine, alice)

    assert admin.http.delete(f"/api/admin/users/{alice.me()['id']}").status_code == 200
    assert entry(bob, entry_id) is None
    assert entry(admin, mine)["shared_with"] == 0
    assert alice.http.get("/api/auth/session").status_code == 401
    overview = admin.http.get("/api/admin/overview").json()
    assert overview["users"] == 2 and overview["entries"] == 1 and overview["shares"] == 0


def test_policy_validation_and_audit_trail(admin: Api):
    assert admin.http.put("/api/admin/policy", json={"kdf_memory_kib": 1024}).status_code == 422
    assert admin.http.put("/api/admin/policy", json={"unknown": 1}).status_code == 422
    saved = admin.http.put("/api/admin/policy", json={"password_max_age_days": 90, "kdf_time_cost": 4}).json()
    assert saved["password_max_age_days"] == 90 and saved["kdf_time_cost"] == 4
    assert admin.http.get("/api/auth/status").json()["policy"]["kdf_time_cost"] == 4

    admin.add_entry()
    trail = admin.http.get("/api/admin/audit").json()
    actions = [row["action"] for row in trail["items"]]
    assert actions[:2] == ["credential.created", "admin.policy_updated"]
    assert "auth.login" in actions and "auth.setup" in actions
    assert trail["items"][0]["actor"] == "admin"
    filtered = admin.http.get("/api/admin/audit", params={"action": "auth."}).json()
    assert filtered["total"] == 2 and all(r["action"].startswith("auth.") for r in filtered["items"])


def test_unknown_api_paths_return_json_404(api: Api):
    res = api.http.get("/api/nope")
    assert res.status_code == 404 and res.json() == {"detail": "Not found"}


def test_audit_details_show_names_not_ids(admin: Api):
    bob, _ = admin.join(admin, "bob")
    entry_id = admin.add_entry()
    share(admin, entry_id, bob)
    rows = admin.http.get("/api/admin/audit", params={"action": "credential.shared"}).json()["items"]
    assert rows[0]["detail"] == "to=bob"


def test_viewer_is_read_only_even_for_entries_they_used_to_manage(admin: Api):
    user, _ = admin.join(admin, "wren")
    entry_id = user.add_entry()
    share(user, entry_id, admin)
    admin.http.patch(f"/api/admin/users/{user.me()['id']}", json={"role": "viewer"})

    rotate = {"ciphertext": b64(120), "wrapped_key": b64(60), "version": 1, "shares": []}
    assert user.http.put(f"/api/credentials/{entry_id}", json={"ciphertext": b64(90), "version": 1}).status_code == 403
    assert user.http.delete(f"/api/credentials/{entry_id}").status_code == 403
    assert user.http.post(f"/api/credentials/{entry_id}/rotate", json=rotate).status_code == 403
    assert share(user, entry_id, admin).status_code == 403
    assert entry(user, entry_id) is not None

    admin.http.patch(f"/api/admin/users/{user.me()['id']}", json={"role": "editor"})
    assert user.http.post(f"/api/credentials/{entry_id}/rotate", json=rotate).status_code == 200
