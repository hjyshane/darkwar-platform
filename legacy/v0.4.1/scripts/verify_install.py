from __future__ import annotations

import sqlite3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> int:
    try:
        import scapy
        import streamlit
        import pandas
        import fastapi
        import uvicorn
        import httpx
    except ImportError as exc:
        print(f"Missing Python dependency: {exc}")
        return 1

    from darkwar_tracker.database import Database

    database_path = ROOT / "data" / "verify.sqlite3"
    if database_path.exists():
        database_path.unlink()

    database = Database(database_path)
    try:
        tables = {
            row[0]
            for row in database.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        required = {
            "alliances",
            "players",
            "member_snapshots",
            "member_entries",
            "member_change_events",
            "capture_events",
            "refresh_jobs",
            "refresh_job_steps",
        }
        missing = required - tables
        if missing:
            print(f"Missing SQLite tables: {sorted(missing)}")
            return 2
    finally:
        database.close()
        database_path.unlink(missing_ok=True)

    seeded = ROOT / "data" / "darkwar.sqlite3"
    if not seeded.exists():
        print("Seed database is missing.")
        return 3

    seeded_db = Database(seeded)
    try:
        backfilled = seeded_db.backfill_member_change_events()
    finally:
        seeded_db.close()

    connection = sqlite3.connect(seeded)
    try:
        alliances = connection.execute(
            "SELECT COUNT(*) FROM alliances"
        ).fetchone()[0]
        players = connection.execute(
            "SELECT COUNT(*) FROM players"
        ).fetchone()[0]
        change_events = connection.execute(
            "SELECT COUNT(*) FROM member_change_events"
        ).fetchone()[0]
    finally:
        connection.close()

    print(f"Scapy: {scapy.__version__}")
    print(f"Streamlit: {streamlit.__version__}")
    print(f"Pandas: {pandas.__version__}")
    print(f"FastAPI: {fastapi.__version__}")
    print(f"Uvicorn: {uvicorn.__version__}")
    print(f"HTTPX: {httpx.__version__}")
    print(f"Seeded alliances: {alliances}")
    print(f"Seeded players: {players}")
    print(f"Change events: {change_events}")
    print(f"Backfilled during verification: {backfilled}")
    print("Installation verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
