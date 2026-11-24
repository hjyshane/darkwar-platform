"""The ingest core: turning a closed capture file into journal rows.

THIS USED TO LIVE IN `cli.py`. It moved because `cli.py` imports `typer` and
`httpx` at module level (line ~15-16) — the CLI framework and the sync HTTP
client — and the desktop app's packaged sidecar explicitly excludes both
(`dw-sidecar.spec`'s `excludes=["scapy", "tkinter", "httpx", "typer"]`): a
process that supervises `dumpcap` and reads a local SQLite journal has no
command line to parse and speaks to nothing over HTTP, so neither dependency
belongs in that binary. `desktop/capture.py` needs exactly the logic below to
ingest the ring it supervises, and `from dw_collector.cli import
_ingest_capture` would import all of `cli.py` first — pulling `typer` and
`httpx` into a process that PyInstaller was told to build without them, and
failing with `ModuleNotFoundError` on a player's machine the moment the
ingest loop first ran. Nothing in the dev test suite catches that, because
tests run with the full dependency set installed.

The other way out — a second decoder living under `desktop/` — was rejected
for the reason this repo always rejects it: two parsers drift, and a decoder
that disagrees with the pipeline produces a confident wrong answer, silently.
So the logic below is unchanged from its time in `cli.py` (down to the
comments explaining its own history) and both `cli.py` (`scan-capture`,
`ingest-dir`) and `desktop/capture.py`'s ingest loop import it from here.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from dw_collector import normalize as _normalize  # noqa: F401  (registers normalizers)
from dw_collector import pipeline, registry
from dw_collector.models import Observation
from dw_collector.protocol.pcapng import (
    Connection,
    GamePorts,
    StreamTable,
    iter_extension_events,
)
from dw_collector.request_log import request_observation
from dw_collector.storage.journal import Journal


@dataclass(frozen=True)
class ScanResult:
    """What ingesting one capture file produced.

    Public (no leading underscore) because it stopped being cli.py's private
    business the moment `desktop/capture.py` needed to read it too.
    """

    ingested: int
    discovered: int
    rejected: int
    commands: dict[str, int]
    # Client requests stored for the command catalog. Not part of `events`.
    requests: int = 0

    @property
    def events(self) -> int:
        return self.ingested + self.discovered


class ServerFollower:
    """The server each logged-in account is on, read from its own `init`.

    `--collected-from-server` is a constant, so an account that moves to
    another server (the sub-account that joined ACE on 579) was labelled with
    the old one until somebody edited `.env`. The login response names the
    account's server (`user.serverId`), so the label can follow it.

    The label is kept PER TCP CONNECTION. The Windows capture is machine-wide:
    every BlueStacks instance on the adapter lands in the same file, so two
    accounts' traffic interleaves and "the last login seen" would label one
    account's data with the other's server. A response is matched to the login
    that opened its connection instead (`ExtensionEvent.connection`, the same
    tuple for both directions). Events with no connection — fixtures, the live
    reassembler — share one slot, which is the one-account behaviour the iPhone
    chain had before.

    Starts every connection at the configured server and keeps each login's
    across files, since the file boundary is dumpcap's rotation, not the
    connection's. A restart forgets the map: a connection that logged in
    before it keeps the configured server until the client reconnects, which
    sends `init` again.
    """

    def __init__(self, default: int) -> None:
        self.default = default
        self._servers: dict[Connection | None, int] = {}

    def observe(
        self, connection: Connection | None, command: str, payload: Mapping[str, object]
    ) -> None:
        if command != "init":
            return
        user = payload.get("user")
        server = user.get("serverId") if isinstance(user, dict) else None
        if isinstance(server, int) and not isinstance(server, bool) and server > 0:
            self._servers[connection] = server

    def server_for(self, connection: Connection | None) -> int:
        return self._servers.get(connection, self.default)


def _ingest_capture(
    journal: Journal,
    pcap: Path,
    *,
    collector_id: uuid.UUID,
    collected_from_server: int,
    port: GamePorts,
    discover_only: bool,
    fallback: datetime,
    follower: ServerFollower | None = None,
    streams: StreamTable | None = None,
) -> ScanResult:
    """One capture file through the pipeline. Shared by scan-capture,
    ingest-dir, and the desktop app's ingest loop so none of the three can
    drift from the one path that has been used by hand all along.

    `streams` is the TCP reassembly state to continue from and leave behind.
    The loops that read a ring pass one table for the whole run, so a frame
    that dumpcap's rotation cut in two completes in the next file (see
    `iter_extension_events`); a one-off `scan-capture` leaves it out.
    """
    ingested = discovered = rejected = requests = 0
    commands: dict[str, int] = {}
    for index, event in enumerate(iter_extension_events(pcap, port=port, streams=streams)):
        if follower is not None:
            if event.direction == "inbound":
                follower.observe(event.connection, event.command, event.payload)
            collected_from_server = follower.server_for(event.connection)
        if event.direction != "inbound":
            # Requests are masked and kept apart from responses; see
            # request_log.py. `discover_only` is about unknown RESPONSES.
            if journal.record_request(
                request_observation(
                    observation_id=uuid.uuid5(
                        uuid.NAMESPACE_URL, f"dw-scan-req:{pcap.name}:{index}:{event.command}"
                    ),
                    collector_id=collector_id,
                    command=event.command,
                    payload=dict(event.payload),
                    captured_at=event.captured_at or fallback,
                    collected_from_server_id=collected_from_server,
                )
            ):
                requests += 1
            continue
        known = registry.get(event.command) is not None
        if discover_only and known:
            continue
        observation = Observation(
            # The file name is part of the id, and dumpcap's ring buffer gives
            # every file a distinct name, so two files never collide. Replays
            # of the SAME file are harmless anyway: idempotency_key hashes the
            # raw payload (§11.2), so re-ingesting updates rather than copies.
            observation_id=uuid.uuid5(
                uuid.NAMESPACE_URL, f"dw-scan:{pcap.name}:{index}:{event.command}"
            ),
            collector_id=collector_id,
            source_command=event.command,
            captured_at=event.captured_at or fallback,
            collected_from_server_id=collected_from_server,
            payload=dict(event.payload),
        )
        try:
            rows = pipeline.observe(observation)
        except ValidationError:
            rejected += 1
            continue
        journal.record(observation, rows)
        commands[event.command] = commands.get(event.command, 0) + 1
        if known:
            ingested += 1
        else:
            discovered += 1
    return ScanResult(ingested, discovered, rejected, commands, requests)


def _ready_captures(directory: Path, minimum_age_seconds: float) -> list[Path]:
    """Capture files dumpcap has finished with, oldest first.

    The newest file in a ring buffer is the one being written, and reading
    it would ingest a truncated tail and then mark it done. Age is the test
    rather than "skip the newest", because a stopped dumpcap leaves its last
    file complete and that one should still be read.

    A file may vanish between the listing and the stat, and that is normal
    rather than exceptional: `-b files:1440` means dumpcap deletes its oldest
    file on every rotation once the ring is full, and this directory is
    rescanned every 30 seconds. The two collide by design.

    It used to raise FileNotFoundError out of the comprehension, and since
    this runs OUTSIDE the per-file `try` in the loop below, that killed the
    whole process — the collector going quiet with a full ring, which is the
    exact failure `ingest-dir` was written to avoid. It was found early by a
    manual cleanup deleting old captures; the ring would have reached it on
    its own about a day later.

    One stat per path rather than two, which also closes the second race: the
    old code stat'd once to filter and again to sort, so a file could survive
    the first call and be gone by the second.
    """
    now = time.time()
    aged: list[tuple[float, Path]] = []
    # .pcap as well: tcpdump on a Mac writes classic pcap, and the reader
    # takes either. dumpcap's ring on Windows only ever writes .pcapng.
    for path in (*directory.glob("*.pcapng"), *directory.glob("*.pcap")):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if now - mtime >= minimum_age_seconds:
            aged.append((mtime, path))
    return [path for _, path in sorted(aged, key=lambda pair: pair[0])]
