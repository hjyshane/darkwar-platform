from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_config
from .database import Database


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply DarkWar SQLite schema migrations."
    )
    parser.add_argument("--config", default="config.toml")
    parser.add_argument("--db")
    args = parser.parse_args()

    config = load_config(args.config)
    database_path = Path(args.db) if args.db else config.database.path
    database = Database(database_path, top_n=config.tracking.top_n)
    try:
        backfilled = database.backfill_member_change_events()
        profile_backfilled = database.backfill_player_profile_events()
        arena_backfilled = database.backfill_arena_events()
    finally:
        database.close()
    print(f"Database schema ready: {database_path.resolve()}")
    print(f"Backfilled change events: {backfilled}")
    print(f"Backfilled player profile rows: {profile_backfilled}")
    print(f"Backfilled arena rows: {arena_backfilled}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
