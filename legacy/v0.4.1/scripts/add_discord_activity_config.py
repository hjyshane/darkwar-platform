from __future__ import annotations

import argparse
from pathlib import Path

SECTION = """

[discord_activity]
enabled = true
host = "127.0.0.1"
port = 8765
viewer_user_ids = []
admin_user_ids = ["YOUR_DISCORD_USER_ID"]
timezone = "America/New_York"
max_rows = 200
allow_dev_bypass = false
""".lstrip("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args()
    path = Path(args.config)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    if "[discord_activity]" in text:
        print(f"discord_activity already exists in {path}")
        return 0
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text + SECTION, encoding="utf-8")
    print(f"Added discord_activity to {path}")
    print("Replace YOUR_DISCORD_USER_ID before enabling admin controls.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
