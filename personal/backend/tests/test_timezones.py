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


def test_timestamps_are_sent_as_utc_whatever_the_computer_zone(zone, owner):
    entry_id = owner.add_entry()
    record = next(c for c in owner.http.get("/api/credentials").json() if c["id"] == entry_id)
    session = owner.http.get("/api/auth/session").json()
    activity = owner.http.get("/api/account/activity").json()[0]
    for stamp in (record["created_at"], record["updated_at"], session["user"]["created_at"], activity["at"]):
        assert stamp.endswith(("Z", "+00:00")), stamp
        assert abs(parse(stamp) - datetime.now(timezone.utc)) < timedelta(seconds=5)


def test_the_vault_file_holds_utc_wall_clock_values(zone, owner):
    owner.add_entry()
    path = owner.app.state.ctx.settings.data_dir / "vault.db"
    with sqlite3.connect(path) as raw:
        (stored,) = raw.execute("select created_at from credentials").fetchone()
    stored_at = datetime.fromisoformat(stored).replace(tzinfo=timezone.utc)
    assert abs(stored_at - datetime.now(timezone.utc)) < timedelta(seconds=5)


def test_idle_lock_does_not_depend_on_the_zone(zone, owner):
    with owner.app.state.ctx.session_factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=14)))
        db.commit()
    assert owner.http.get("/api/auth/session").status_code == 200
    with owner.app.state.ctx.session_factory() as db:
        db.execute(update(Session).values(last_seen_at=utcnow() - timedelta(minutes=16)))
        db.commit()
    assert owner.http.get("/api/auth/session").status_code == 401
