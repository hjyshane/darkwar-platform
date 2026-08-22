"""Find one player's position inside a capture file.

WHY THIS IS NOT IN THE DASHBOARD. The obvious shape is an upload box on the
map tab, and it is the wrong one twice over. A raw PCAP carries the capturing
account's uid and session signature, so uploading one puts a live credential
in cloud storage — the same class of mistake as the fixture that leaked 164
real uids. And the dashboard is a static site: decoding a pcapng needs packet
reassembly and a protobuf reader, neither of which exists in a browser, so
the file would have to travel to the cloud and back to reach the decoder that
is already sitting on the machine the file is on.

So the search happens where the file already is, against the same decoder the
continuous pipeline uses.

UID RATHER THAN NAME is the point of the whole thing. Names carry emoji,
spaces and lookalike characters, and a player who is being hunted is exactly
the one whose name will not paste cleanly. A uid is sixteen digits that do
not change. Names still match, as a convenience, but the uid is the handle.
"""

from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from dw_collector.storage.journal import Journal

#: Read-only work: the scan writes into a throwaway journal in the temp
#: directory rather than the live one. A capture somebody is inspecting by
#: hand is not necessarily one that should join the record — it may be a
#: partial sweep, or the same ground twice — and the continuous pipeline is
#: already ingesting the real ring.
SCRATCH_PREFIX = "dw-find-"


@dataclass(frozen=True)
class Found:
    """One tile matching the search."""

    name: str | None
    game_uid: int
    server_id: int
    x: int
    y: int
    hq_level: int | None


@dataclass(frozen=True)
class Scan:
    """What a capture turned out to hold."""

    tiles: int
    matches: tuple[Found, ...]
    #: The box the capture actually covered, or None when it held no tiles.
    #: THE MOST USEFUL THING WHEN NOTHING MATCHED: a sweep that never passed
    #: over the ground cannot say anything about who is standing on it, and
    #: "not found" reads as "they moved" unless the covered box is shown.
    covered: tuple[int, int, int, int] | None = None

    @property
    def covers(self) -> str:
        if self.covered is None:
            return "no tiles at all"
        x0, x1, y0, y1 = self.covered
        return f"x {x0}..{x1}, y {y0}..{y1}"

    def saw(self, x: int, y: int) -> bool:
        """Whether a coordinate was inside the ground this capture read."""
        if self.covered is None:
            return False
        x0, x1, y0, y1 = self.covered
        return x0 <= x <= x1 and y0 <= y <= y1


def matches(needle: str, name: str | None, game_uid: int) -> bool:
    """Whether a tile answers to what was typed.

    A uid is matched WHOLE. A substring match on sixteen digits would let a
    six-digit server suffix pull in every player on that server, which is the
    opposite of narrowing.
    """
    wanted = needle.strip()
    if not wanted:
        return False
    if wanted.isdigit():
        return str(game_uid) == wanted
    return name is not None and wanted.lower() in name.lower()


def search(pcap: Path, needle: str, *, port: int = 8680) -> Scan:
    """Decode a capture and return the tiles matching `needle`."""
    from dw_collector.cli import _ingest_capture

    with tempfile.TemporaryDirectory(prefix=SCRATCH_PREFIX) as scratch:
        journal = Journal(Path(scratch) / "scan.db")
        journal.init_db()
        try:
            _ingest_capture(
                journal,
                pcap,
                collector_id=uuid.UUID("00000000-0000-4000-8000-00000000c777"),
                collected_from_server=580,
                port=port,
                discover_only=False,
                fallback=datetime.now(tz=UTC),
            )
            return _read(journal, needle)
        finally:
            journal.close()


def _read(journal: Journal, needle: str) -> Scan:
    import json

    found: list[Found] = []
    seen: set[tuple[int, int, int]] = set()
    xs: list[int] = []
    ys: list[int] = []
    tiles = 0
    cursor = journal.conn.execute(
        "select row_json from normalized_rows where target_table = 'world_city_snapshots'"
    )
    for (raw,) in cursor.fetchall():
        try:
            row = json.loads(raw)["row"]
        except (ValueError, KeyError):
            continue
        x, y = row.get("x"), row.get("y")
        if x is None or y is None:
            continue
        tiles += 1
        xs.append(int(x))
        ys.append(int(y))
        uid = int(row.get("game_uid") or 0)
        if matches(needle, row.get("name"), uid):
            # ONE ENTRY PER PLACE. Pans overlap, so a single base near the
            # edge of a sweep is written once per viewport that caught it —
            # four rows for one tile, which reads as four findings.
            place = (uid, int(x), int(y))
            if place in seen:
                continue
            seen.add(place)
            found.append(
                Found(
                    name=row.get("name"),
                    game_uid=uid,
                    server_id=int(row.get("server_id") or 0),
                    x=int(x),
                    y=int(y),
                    hq_level=row.get("hq_level"),
                )
            )
    covered = (min(xs), max(xs), min(ys), max(ys)) if xs else None
    return Scan(tiles=tiles, matches=tuple(found), covered=covered)
