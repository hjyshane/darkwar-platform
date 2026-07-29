from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.config import load_config
from darkwar_tracker.database import Database
from darkwar_tracker.refresh_control import JOB_STEPS, queue_job


def main() -> int:
    parser = argparse.ArgumentParser(description="Queue an idle-aware refresh job.")
    parser.add_argument("job_type", choices=tuple(JOB_STEPS))
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--priority", type=int, default=50)
    args = parser.parse_args()

    config = load_config(args.config)
    database = Database(config.database.path, top_n=config.tracking.top_n)
    database.close()
    job_id = queue_job(
        config.database.path,
        args.job_type,
        config=config,
        trigger_type="manual",
        fresh_after=dt.datetime.now(dt.timezone.utc),
        priority=args.priority,
        idle_required=True,
        details={"requested_from": "command_line"},
    )
    print(f"queued_job_id={job_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
