from __future__ import annotations

import argparse
from pathlib import Path

SECTION = r'''

[refresh_automation]
# Passive capture is always preferred. UI automation runs only after Windows
# has been idle for the configured period.
enabled = true

# Weekly full refresh: Monday server reset (02:00 UTC) + 5 minutes.
weekly_enabled = true
weekly_weekday_utc = 0
reset_hour_utc = 2
reset_minute_utc = 0
weekly_delay_seconds = 300

# User activity immediately postpones or pauses automation.
idle_seconds_required = 300
poll_seconds = 30
interrupt_check_seconds = 1

# Leave blank to auto-detect BlueStacks ADB.
adb_path = ""
device_serial = ""
package = "com.readygo.dark.gp"
sequence_dir = "data/refresh_sequences"

launch_wait_seconds = 25
tap_wait_seconds = 3
verification_timeout_seconds = 75
max_attempts = 3
catch_up_weekly = true
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args()
    path = Path(args.config)
    text = path.read_text(encoding="utf-8")
    if "[refresh_automation]" in text:
        print("[refresh_automation] already exists; no changes made")
        return 0
    path.write_text(text.rstrip() + SECTION + "\n", encoding="utf-8")
    print(f"Added [refresh_automation] to {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
