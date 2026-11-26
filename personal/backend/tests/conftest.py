from __future__ import annotations

import base64
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from ams.config import Settings
from ams.main import create_app

HEADERS = {"X-AMS-Request": "1"}


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


def vault_material(**extra) -> dict:
    body = {
        "name": "Sam",
        "kdf": {"salt": b64(16), "time_cost": 3, "memory_kib": 65536, "parallelism": 1},
        "auth_key": b64(32),
        "wrapped_vault_key": b64(60),
        "recovery_auth_key": b64(32),
        "recovery_wrapped_vault_key": b64(60),
    }
    body.update(extra)
    return body


class Api:
    def __init__(self, app, base_url: str = "http://localhost:8100"):
        self.app = app
        self.http = TestClient(app, base_url=base_url, headers=HEADERS)

    def other(self) -> "Api":
        return Api(self.app)

    def login(self, material: dict):
        return self.http.post("/api/auth/login", json={"auth_key": material["auth_key"]})

    def add_entry(self) -> str:
        entry_id = str(uuid.uuid4())
        res = self.http.post("/api/credentials", json={"id": entry_id, "ciphertext": b64(120), "wrapped_key": b64(60)})
        assert res.status_code == 201, res.text
        return entry_id


@pytest.fixture
def app(tmp_path):
    settings = Settings.from_env({"AMS_DATA_DIR": str(tmp_path), "AMS_STATIC_DIR": str(tmp_path / "no-client")})
    application = create_app(settings)
    yield application
    application.state.engine.dispose()


@pytest.fixture
def api(app) -> Api:
    return Api(app)


@pytest.fixture
def owner(api) -> Api:
    api.material = vault_material()
    assert api.http.post("/api/auth/setup", json=api.material).status_code == 201
    assert api.login(api.material).status_code == 200
    return api
