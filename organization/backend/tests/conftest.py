from __future__ import annotations

import base64
import os
import re
import uuid

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from ams.config import Settings
from ams.mail import MailError
from ams.main import create_app

HEADERS = {"X-AMS-Request": "1"}


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


def public_key() -> str:
    key = ec.generate_private_key(ec.SECP256R1()).public_key()
    raw = key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.b64encode(raw).decode()


def registration(username: str, **extra) -> dict:
    body = {
        "username": username,
        "email": f"{username}@example.com",
        "kdf": {"salt": b64(16), "time_cost": 3, "memory_kib": 65536, "parallelism": 1},
        "auth_key": b64(32),
        "wrapped_vault_key": b64(60),
        "public_key": public_key(),
        "wrapped_private_key": b64(166),
        "recovery_auth_key": b64(32),
        "recovery_wrapped_vault_key": b64(60),
    }
    body.update(extra)
    return body


class Api:
    def __init__(self, app):
        self.app = app
        self.http = TestClient(app, base_url="https://ams.test", headers=HEADERS)

    def other(self) -> "Api":
        return Api(self.app)

    def setup_admin(self, username: str = "admin") -> dict:
        reg = registration(username, setup_token=self.app.state.setup_token)
        assert self.http.post("/api/auth/setup", json=reg).status_code == 201
        return reg

    def login(self, reg: dict):
        return self.http.post("/api/auth/login", json={"username": reg["username"], "auth_key": reg["auth_key"]})

    def invite(self, role: str = "editor") -> str:
        res = self.http.post("/api/admin/invites", json={"role": role, "label": "test"})
        assert res.status_code == 201, res.text
        return res.json()["token"]

    def join(self, admin: "Api", username: str, role: str = "editor") -> tuple["Api", dict]:
        reg = registration(username, invite_token=admin.invite(role))
        browser = self.other()
        assert browser.http.post("/api/auth/register", json=reg).status_code == 201
        assert browser.login(reg).status_code == 200
        return browser, reg

    def me(self) -> dict:
        return self.http.get("/api/auth/session").json()["user"]

    def add_entry(self) -> str:
        entry_id = str(uuid.uuid4())
        res = self.http.post(
            "/api/credentials", json={"id": entry_id, "ciphertext": b64(120), "wrapped_key": b64(60)}
        )
        assert res.status_code == 201, res.text
        return entry_id


@pytest.fixture
def app(tmp_path):
    settings = Settings.from_env(
        {"AMS_DATA_DIR": str(tmp_path), "AMS_STATIC_DIR": str(tmp_path / "no-client"), "AMS_ALLOWED_HOSTS": "*"}
    )
    application = create_app(settings)
    yield application
    application.state.engine.dispose()


@pytest.fixture
def api(app) -> Api:
    return Api(app)


@pytest.fixture
def admin(api) -> Api:
    reg = api.setup_admin()
    assert api.login(reg).status_code == 200
    api.reg = reg
    return api


class FakeMailer:
    enabled = True

    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []
        self.fail = False

    def send(self, to: str, subject: str, body: str) -> None:
        if self.fail:
            raise MailError("down")
        self.sent.append((to, subject, body))

    def last_code(self) -> str:
        return re.search(r"\b(\d{6})\b", self.sent[-1][2]).group(1)


@pytest.fixture
def mail(app) -> FakeMailer:
    mailer = FakeMailer()
    app.state.ctx.mailer = mailer
    return mailer
