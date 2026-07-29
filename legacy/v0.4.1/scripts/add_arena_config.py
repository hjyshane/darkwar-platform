from __future__ import annotations

import argparse
from pathlib import Path

SECTION = r'''

[arena_automation]
# Daily arena refresh runs at server reset + 2 minutes.
enabled = false
adb_path = ""
device_serial = ""
package = "com.readygo.dark.gp"
# Recommended for deterministic navigation. Set false to avoid interrupting play.
force_restart_game = true
sequence_path = "data/arena_taps.json"
reset_hour_utc = 2
reset_minute_utc = 0
delay_after_reset_seconds = 120
launch_wait_seconds = 20
tap_wait_seconds = 3
verification_timeout_seconds = 45
retry_delays_seconds = [60, 180, 600]
catch_up_after_start = true
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args()

    path = Path(args.config)
    text = path.read_text(encoding="utf-8")
    if "[arena_automation]" in text:
        print("arena_automation section already exists")
        return 0

    path.write_text(text.rstrip() + SECTION + "\n", encoding="utf-8")
    print(f"Added arena_automation section to {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
