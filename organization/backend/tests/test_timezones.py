from __future__ import annotations

import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from ams.db import utcnow
from ams.models import Session

ZONES = ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"]


@pytest.fixture(params=ZONES)
def zone(request):
    if not hasattr(time, "tzset"):
        pytest.skip("this platform cannot switch time zone inside a process")
    before = os.environ.get("TZ")
    os.environ["TZ"] = request.param
    time.tzset()
    yield request.param
    if before is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = before
    time.tzset()


def parse(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def test_utcnow_is_utc_in_every_zone(zone):
    now = utcnow()
    assert now.utcoffset() == timedelta(0)
    assert abs(now.timestamp() - time.time()) < 2


def test_timestamps_are_sent_as_utc_whatever_the_server_zone(zone, admin):
    entry_id = admin.add_entry()
    record = next(c for c in admin.http.get("/api/credentials").json() if c["id"] == entry_id)
    session = admin.http.get("/api/auth/session").json()
    for stamp in (record["created_at"], record["updated_at"], session["user"]["created_at"], session["session"]["expires_at"]):
        assert stamp.endswith(("Z", "+00:00")), stamp
    assert abs(parse(record["created_at"]) - datetime.now(timezone.utc)) < timedelta(seconds=5)
    assert parse(session["session"]["expires_at"]) - datetime.now(timezone.utc) > timedelta(hours=11)


def test_the_database_holds_utc_wall_clock_values(zone, admin):
    admin.add_entry()
    path = admin.app.state.ctx.settings.data_dir / "ams.db"
    with sqlite3.connect(path) as raw:
        (stored,) = raw.execute("select created_at from credentials").fetchone()
    stored_at = datetime.fromisoformat(stored).replace(tzinfo=timezone.utc)
    assert abs(stored_at - datetime.now(timezone.utc)) < timedelta(seconds=5)


def test_session_and_invite_expiry_do_not_depend_on_the_zone(zone, admin):
    assert admin.http.get("/api/auth/session").status_code == 200
    token = admin.invite()
    assert admin.other().http.post("/api/auth/invite/check", json={"token": token}).status_code == 200

    with admin.app.state.ctx.session_factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=14)))
        db.commit()
    assert admin.http.get("/api/auth/session").status_code == 200
    with admin.app.state.ctx.session_factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=16)))
        db.commit()
    assert admin.http.get("/api/auth/session").status_code == 401


def test_audit_times_and_the_24_hour_window_use_utc(zone, admin):
    admin.other().http.post("/api/auth/login", json={"username": "admin", "auth_key": "A" * 43 + "="})
    assert admin.http.get("/api/admin/overview").json()["failed_logins_24h"] == 1
    row = admin.http.get("/api/admin/audit").json()["items"][0]
    assert row["at"].endswith(("Z", "+00:00"))
    assert abs(parse(row["at"]) - datetime.now(timezone.utc)) < timedelta(seconds=5)
