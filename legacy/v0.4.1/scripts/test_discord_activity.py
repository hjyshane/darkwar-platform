from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    import os
    import sys

    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))

    from darkwar_tracker.activity_api import create_app

    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        database = temp / "darkwar.sqlite3"
        shutil.copy2(ROOT / "data" / "darkwar.sqlite3", database)
        config = temp / "config.toml"
        config.write_text(
            f"""
[capture]
interface = ""
port = 8680
server_ip = ""

[database]
path = "{database.as_posix()}"

[tracking]
servers = [577, 578, 579, 580, 581, 582, 583, 584]
top_n = 3

[activity]
own_alliance_code = "CBFW"
auto_refresh_seconds = 30
inactive_warning_days = 3
inactive_critical_days = 7
pass_expiry_warning_days = 7

[arena_automation]
enabled = false
package = "com.readygo.dark.gp"

[refresh_automation]
enabled = true
weekly_enabled = true
weekly_weekday_utc = 0
reset_hour_utc = 2
reset_minute_utc = 0
weekly_delay_seconds = 300
idle_seconds_required = 300

[discord_activity]
enabled = true
host = "127.0.0.1"
port = 8765
viewer_user_ids = []
admin_user_ids = []
timezone = "America/New_York"
max_rows = 200
allow_dev_bypass = true
""",
            encoding="utf-8",
        )
        app = create_app(config)
        client = TestClient(app)
        headers = {"X-DarkWar-Dev-Bypass": "1"}

        health = client.get("/api/health")
        assert health.status_code == 200, health.text
        assert health.json()["ok"] is True

        session = client.get("/api/session", headers=headers)
        assert session.status_code == 200, session.text
        assert session.json()["is_admin"] is True

        for endpoint in (
            "/api/overview",
            "/api/arena",
            "/api/rankings",
            "/api/alliances",
            "/api/players?query=",
            "/api/refresh/jobs",
            "/api/changes",
        ):
            response = client.get(endpoint, headers=headers)
            assert response.status_code == 200, (endpoint, response.text)

        queued = client.post(
            "/api/refresh/queue",
            headers=headers,
            json={"job_type": "arena", "idle_required": True},
        )
        assert queued.status_code == 200, queued.text
        job_id = queued.json()["job_id"]

        jobs = client.get("/api/refresh/jobs", headers=headers)
        assert any(row["job_id"] == job_id for row in jobs.json()["jobs"])

        cancelled = client.post(
            f"/api/refresh/jobs/{job_id}/cancel",
            headers=headers,
        )
        assert cancelled.status_code == 200, cancelled.text

    print("discord activity API regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
