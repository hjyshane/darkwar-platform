from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from darkwar_tracker.database import Database


def main() -> int:
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = Path(temp_dir) / "bytes_test.sqlite3"
        database = Database(db_path)

        try:
            database.handle_event(
                direction="inbound",
                command="test.binary",
                payload={
                    "_id": 999,
                    "blob": b"\x00\x01\xfe\xff",
                    "nested": [bytearray(b"abc")],
                },
                request_id=999,
            )
        finally:
            database.close()

        connection = sqlite3.connect(db_path)
        try:
            raw_json = connection.execute(
                "SELECT raw_json FROM capture_events"
            ).fetchone()[0]
        finally:
            connection.close()

        decoded = json.loads(raw_json)
        assert decoded["blob"]["__darkwar_type__"] == "bytes"
        assert decoded["blob"]["hex"] == "0001feff"
        assert decoded["nested"][0]["hex"] == "616263"

    print("bytes payload regression test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
