"""The desktop app's Python half.

WHO CALLS THIS. Only the Rust side, over loopback, on a port the OS picks and
this process announces on stdout. The webview never speaks to it directly,
which is why there is no CORS handling here and no authentication: the
security property is that the port is never published, not that callers are
checked.

Stdlib http.server rather than a framework, for the reason the console is
Tkinter — a shipped tool that needs its own install is one more thing to be
broken on somebody else's machine.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import asdict, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import ParseResult, parse_qs, urlparse

from dw_collector.desktop import adapters, capture, localread, settings

HOST = "127.0.0.1"

#: What `/health` found when it looked. The window shows a different sentence
#: for each, because they need different things from the user: start the
#: collector, or fix the path.
READY = "ready"
NO_JOURNAL = "no-journal"
UNREADABLE = "unreadable"


def journal_state(journal_path: Path) -> str:
    """Whether the journal is there and readable — WITHOUT creating it.

    THE EXISTENCE CHECK HAS TO COME FIRST. `sqlite3.connect` creates a
    missing file rather than failing, so a read endpoint that connects
    optimistically leaves a 0-byte database behind at whatever path it was
    pointed at, and every later run finds that file and reports an empty
    journal instead of a missing one. The typo becomes permanent and stops
    looking like a typo.
    """
    if not journal_path.exists():
        return NO_JOURNAL
    conn = sqlite3.connect(journal_path)
    try:
        conn.execute("select 1 from normalized_rows limit 1").fetchone()
    except sqlite3.DatabaseError:
        # A file that is not a journal, or one written by a version that did
        # not have this table yet. Either way the window must say so rather
        # than show an empty result that looks like an answer.
        return UNREADABLE
    finally:
        conn.close()
    return READY


def _count_pcapng_files(capture_dir: str) -> int:
    """How many `.pcapng` files sit in `capture_dir` right now.

    A DIRECTORY LISTING, NOT A QUERY. Cost is proportional to the number of
    files dumpcap's ring buffer ever holds at once — capped at
    `capture._RING_FILES` (5760) — never to how much data any one of them
    contains, which is what makes this cheap enough to answer on every poll
    of `/capture/status`.

    An unconfigured or missing directory is zero files, not an error —
    `/capture/status` must answer 200 on a fresh install same as everywhere
    else in this module.
    """
    if not capture_dir:
        return 0
    path = Path(capture_dir)
    if not path.is_dir():
        return 0
    return sum(1 for _ in path.glob("*.pcapng"))


def _cheap_row_count(journal_path: Path) -> int:
    """How many rows the journal holds, counted from `raw_observations`.

    NOT `select count(*)`. `/capture/status` is meant to be polled on a
    timer, and `raw_observations` can hold six figures — a full-table count
    on every poll is exactly the kind of cost that compounds under polling.
    `max(rowid)` answers from the rowid b-tree alone (a rightmost descent),
    no table scan, which is the same reasoning `Journal.watermark` already
    uses this table and this column for. `raw_observations` rather than
    `normalized_rows`: it is the one row every observation starts as, where
    `normalized_rows` can hold several derived rows per observation and
    would inflate the count without telling a player anything about how
    much has actually come in.

    This is a proxy, not an exact count — it would overcount against a
    journal `cli.py`'s `prune` command has ever trimmed, since a deleted row
    lowers the true count but not the highest rowid ever issued. Nothing
    that prunes runs against a player's desktop journal, and a slightly
    stale number on a screen that only cares whether it is moving is a fine
    trade for an index-only read on every poll.

    A missing or unreadable journal counts as zero rather than raising —
    `/capture/status` must answer 200 always, same as `journal_state`.
    """
    if not journal_path.exists():
        return 0
    try:
        conn = sqlite3.connect(journal_path)
    except sqlite3.DatabaseError:
        return 0
    try:
        cur = conn.execute("select coalesce(max(rowid), 0) from raw_observations")
        return int(cur.fetchone()[0])
    except sqlite3.DatabaseError:
        return 0
    finally:
        conn.close()


def capture_status_json(status: capture.CaptureStatus, *, files: int, rows: int) -> dict[str, Any]:
    """`status`, plus how much has actually landed, as the window reads it.

    `files`/`rows` answer a different question than `status.state`: a
    capture pointed at the wrong adapter can sit at `state="running"` for
    hours and never produce anything a player would call data. See
    `capture.IngestStatus`'s own docstring for the same distinction one
    layer down — "dumpcap is running" and "data is arriving" are different
    questions, and only the second one tells a player it is working.
    """
    return {
        "capture": {
            "state": status.state,
            "pid": status.pid,
            "returncode": status.returncode,
            "stderr": status.stderr,
        },
        "ingest": {
            "state": status.ingest.state,
            "filesSeen": status.ingest.files_seen,
            "filesIngested": status.ingest.files_ingested,
            "rowsWritten": status.ingest.rows_written,
            "error": status.ingest.error,
        },
        "files": files,
        "rows": rows,
    }


def tile_json(
    *,
    game_uid: int,
    server_id: int,
    name: str | None,
    x: int,
    y: int,
    hq_level: int | None,
    captured_at: str,
) -> dict[str, Any]:
    """One tile as the window reads it.

    THE UID IS A STRING, always. It is sixteen digits, and
    `Number.MAX_SAFE_INTEGER` is sixteen digits too — the margin is one order
    of magnitude. A uid that rounds is not a typo the reader spots, it is a
    different player.
    """
    return {
        "gameUid": str(game_uid),
        "serverId": server_id,
        "name": name,
        "x": x,
        "y": y,
        "hqLevel": hq_level,
        "capturedAt": captured_at,
    }


def player_json(profile: localread.PlayerProfile) -> dict[str, Any]:
    """One player profile as the window reads it.

    THE UID IS A STRING, always — same reasoning as `tile_json`: a sixteen
    digit uid is one order of magnitude from `Number.MAX_SAFE_INTEGER`, and
    a uid that rounds is a different player, not a typo anyone would spot.

    `capturedAt` IS THE NEWEST OF ANY CONTRIBUTING SIGHTING — exactly what
    `PlayerProfile.captured_at` already means (see `players.py`'s
    docstrings). It answers "when did we last see this player at all", not
    "when was this exact combination of fields true together" — no such
    single moment necessarily exists once fields are sourced from three
    different commands (`kill.rank`, `server.rank`,
    `get.user.info.multi`), each reporting on a different subset of them.
    A per-field `capturedAt` would be more honest about that gap, but it
    would also hand the screen six more ambiguous timestamps for the one
    question a player showing up here actually asks — "how stale is what
    I'm looking at" — so this crosses the one number that answers that,
    and this comment is where that choice is made explicit rather than
    silently picking one of two equally defensible shapes.
    """
    return {
        "gameUid": str(profile.game_uid),
        "serverId": profile.server_id,
        "name": profile.name,
        "allianceExternalId": profile.alliance_external_id,
        "hqLevel": profile.hq_level,
        "power": profile.power,
        "kills": profile.kills,
        "rank": profile.rank,
        "capturedAt": profile.captured_at,
    }


def player_detail_json(detail: localread.PlayerDetail) -> dict[str, Any]:
    """One power breakdown as the window reads it.

    `componentsSumMatches` CROSSES EXACTLY AS `PlayerDetail` CARRIES IT —
    `null` for "too few components were present to check", `false` for
    "the six components did not sum to `powerTotal`", never silently
    coerced to a boolean. Presenting `powerTotal` alone, with the
    disagreement dropped on the floor, would show an unverified number as
    if it were exact — the whole reason this projection exists as its own
    table instead of a field on `PlayerProfile` (see `player_detail.py`).
    """
    return {
        "powerTotal": detail.power_total,
        "powerComponents": detail.power_components,
        "componentsSumMatches": detail.components_sum_matches,
        "capturedAt": detail.captured_at,
    }


def roster_member_json(entry: localread.RosterEntry) -> dict[str, Any]:
    """One roster member as the window reads it.

    THE UID IS A STRING, always — same reasoning as `tile_json` and
    `player_json`.

    `presenceRedacted` IS NOT A COLUMN. It crosses on the wire (the window
    needs the fact to decide what to render), but see `roster_json` for why
    it is also lifted to the roster level rather than left as a bare
    per-member boolean the window would have to interpret on its own.
    `onlineState`/`offlineSince` cross exactly as `RosterEntry` carries
    them — both null on every member when the snapshot is redacted (see
    `roster.py`'s module docstring), never coerced into a guessed state.
    """
    return {
        "gameUid": str(entry.game_uid),
        "serverId": entry.server_id,
        "name": entry.name,
        "memberRank": entry.member_rank,
        "hqLevel": entry.hq_level,
        "power": entry.power,
        "kills": entry.kills,
        "onlineState": entry.online_state,
        "offlineSince": entry.offline_since,
        "monthCardExpiresAt": entry.month_card_expires_at,
    }


def roster_json(entries: list[localread.RosterEntry]) -> dict[str, Any]:
    """The current alliance roster as the window reads it.

    `capturedAt` AND `presenceRedacted` ARE LIFTED TO THIS LEVEL, not left as
    per-member fields. Every member in `entries` comes from the same
    `al.rank` call (`newest_roster` groups by `observation_id` — see
    `roster.py`), so both facts are already identical across every row; a
    roster is exactly as fresh as the last time the player opened that
    screen in game, and `presenceRedacted` describes the SNAPSHOT the game
    chose to redact, not any one member. An empty roster (nothing captured
    yet) has no shared timestamp to report, so `capturedAt` is null rather
    than an invented empty string a window might mistake for "just now".
    """
    return {
        "capturedAt": entries[0].captured_at if entries else None,
        "presenceRedacted": entries[0].presence_redacted if entries else False,
        "members": [roster_member_json(entry) for entry in entries],
    }


def _player_by_uid(conn: sqlite3.Connection, uid: int) -> localread.PlayerProfile | None:
    """The one profile carrying exactly `uid`, or None if never seen.

    `search_players` matches a digit needle WHOLE (see
    `console.find.matches`), so passing the uid straight through finds
    only profiles carrying that exact uid, never a substring hit. A small
    limit is passed rather than the fold's default: sixteen-digit game
    uids already encode the server they belong to (the trailing digits
    equal `server_id` in every capture seen so far), so two profiles
    sharing one exact uid across two different servers is not a case this
    journal is expected to produce — but the limit still guards against
    pulling the whole fold for a caller that only ever wants one row.
    """
    found = localread.search_players(conn, str(uid), limit=5)
    return found[0] if found else None


def _detail_for(
    conn: sqlite3.Connection, *, server_id: int, game_uid: int
) -> localread.PlayerDetail | None:
    """The newest power breakdown for one (server_id, game_uid), or None.

    `player_detail_snapshots` has no fold cache of its own (see
    `player_detail.py` — a single writer never needed one), so this folds
    fresh on every call, same as every other direct caller of
    `newest_detail_per_player`.
    """
    for detail in localread.newest_detail_per_player(localread.player_details(conn)):
        if detail.server_id == server_id and detail.game_uid == game_uid:
            return detail
    return None


#: `Settings` field names paired with the camelCase key that crosses the
#: wire, in the same spirit as `tile_json`. One list drives both directions
#: (`_settings_to_camel` and `_settings_fields_from_body`) so the two can
#: never drift apart into mismatched key names.
_SETTINGS_WIRE_FIELDS: tuple[tuple[str, str], ...] = (
    ("journal_path", "journalPath"),
    ("capture_dir", "captureDir"),
    ("interface", "interface"),
    ("dumpcap_path", "dumpcapPath"),
    ("server_id", "serverId"),
    ("game_port", "gamePort"),
    ("collector_id", "collectorId"),
)

#: PUT /settings' Content-Length cap. A handful of paths and two small ints
#: never approaches this; a body anywhere near it is not a settings payload —
#: it is a bug or a hung client — and it is cheaper to refuse it up front
#: than to buffer it into memory first.
_MAX_SETTINGS_BODY = 64 * 1024


def _settings_to_camel(value: settings.Settings) -> dict[str, Any]:
    """`value` as the camelCase JSON the window expects back."""
    data = asdict(value)
    return {camel: data[snake] for snake, camel in _SETTINGS_WIRE_FIELDS}


def _pinned_by_environment(file_only: settings.Settings, effective: settings.Settings) -> list[str]:
    """camelCase field names where `effective` differs from `file_only`.

    A field only ends up different here because `settings.load` let an
    environment variable win over the file for it — that is the ONLY thing
    that can make these two diverge, since `effective` is `file_only` with
    the environment applied on top. The window uses this list to tell a
    player "this is set by your environment" instead of silently reverting
    whatever they just typed, which is exactly the confusing behavior this
    field exists to explain.
    """
    file_data = asdict(file_only)
    effective_data = asdict(effective)
    return [
        camel for snake, camel in _SETTINGS_WIRE_FIELDS if file_data[snake] != effective_data[snake]
    ]


def _str_field(body: dict[str, Any], camel_key: str, default: str) -> str:
    """`body[camel_key]` if it is actually a string, else `default`.

    A wrong-typed or absent field falls back rather than raising — this is
    a background merge onto whatever the file already holds, not a strict
    schema-validation endpoint, and an unknown or malformed field must not
    take the sidecar down any more than an unknown file key does in
    `settings._from_file`.
    """
    value = body.get(camel_key, default)
    return value if isinstance(value, str) else default


def _int_field(body: dict[str, Any], camel_key: str, default: int) -> int:
    """`body[camel_key]` if it is actually an `int`, else `default`.

    `bool` is an `int` subclass in Python, so `isinstance(True, int)` is
    true — but a `serverId` of `true` is exactly as wrong as one of
    `"581"`, so it is rejected the same way, not let through because of the
    subclass rule. Same reasoning as `settings._from_file`.
    """
    value = body.get(camel_key, default)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return default


def _merge_settings_body(current: settings.Settings, body: dict[str, Any]) -> settings.Settings:
    """`current` with the body's known, correctly-typed fields overlaid.

    THE FIELDS ARE APPLIED ONE BY ONE, NOT VIA A SPLATTED DICT — the exact
    trap `settings.load`'s own docstring calls out: a dict of mixed
    `str | int` values loses the per-field type `dataclasses.replace` needs
    to check under `mypy --strict`. Naming each field here keeps the string
    fields strings and the int fields ints all the way through.

    `collector_id` IS NEVER READ FROM `body`, on purpose — no `_field` call
    for it exists above. It is one of five components hashed into the
    journal's `idempotency_key` (see `settings.ensure_collector_id`); letting
    a value from the wire reach `replace` here would let the window silently
    re-key the entire dedup history. See `Handler.do_PUT` for why `current`
    is what supplies it instead.

    `journal_path` IS ACCEPTED HERE AND SAVED TO DISK LIKE ANY OTHER FIELD —
    but saving it is not the same as USING it. The one journal path any
    `Supervisor`, `/health`, or `/find` in this process ever touches is
    `_Server.journal_path`, fixed at process start; see that attribute's
    docstring for why a `PUT` here can only ever take effect on the sidecar's
    NEXT launch, never on whatever is already running.
    """
    return replace(
        current,
        journal_path=_str_field(body, "journalPath", current.journal_path),
        capture_dir=_str_field(body, "captureDir", current.capture_dir),
        interface=_str_field(body, "interface", current.interface),
        dumpcap_path=_str_field(body, "dumpcapPath", current.dumpcap_path),
        server_id=_int_field(body, "serverId", current.server_id),
        game_port=_int_field(body, "gamePort", current.game_port),
    )


def _default_supervisor_factory(dumpcap: str, journal_path: Path) -> capture.Supervisor:
    """The real factory `serve()`/`_Server` use in production.

    THIS IS THE FIX for "files climb, rows never do": before this, production
    called `capture.Supervisor` directly as the factory, and
    `Supervisor.__init__`'s default is `journal_path=None` — which is exactly
    what tells `Supervisor._start_ingest_loop` never to start the ingest
    thread at all. dumpcap ran, the ring rotated, `files` climbed, and the
    `Supervisor` `Handler._get_or_create_supervisor` handed back had no path
    to ever read one of those files into. Passing `journal_path=journal_path`
    through here is the entire fix — `capture.py`'s ingest loop, its
    `init_db()` on first use (`_default_journal_factory`), and its
    single-writer-thread discipline already worked correctly the moment a
    path actually arrived.
    """
    return capture.Supervisor(dumpcap, journal_path=journal_path)


class _Server(ThreadingHTTPServer):
    """Carries the journal path so the handler can read it off `self.server`.

    A handler class attribute set with `type(...)` per call is one more thing
    for mypy --strict to be unhappy about typing; the server the stdlib
    already threads through to every handler instance has no such problem.
    """

    def __init__(
        self,
        address: tuple[str, int],
        journal_path: Path,
        settings_path: Path,
        *,
        find_dumpcap: Callable[[], str | None] = adapters.find_dumpcap,
        probe_run: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
        supervisor_factory: Callable[[str, Path], capture.Supervisor] = _default_supervisor_factory,
    ) -> None:
        super().__init__(address, Handler)
        # FIXED FOR THE LIFE OF THIS PROCESS. `/health`, `/find`,
        # `/capture/status`'s row count, and — via `supervisor_factory` below
        # — the one journal the capture `Supervisor`'s ingest thread is ever
        # given all read this SAME attribute, never `Settings.journal_path`
        # (the field `PUT /settings` can rewrite in `settings.json` at any
        # time, including while a capture is running). That is the answer to
        # "what happens when the journal path changes while running": NOTHING
        # happens to anything already live in this process. A `PUT` that
        # changes `journalPath` still saves to disk and is honoured the NEXT
        # time the sidecar starts — it can never reach a `Supervisor` or a
        # `/find` connection this process already opened. The alternative
        # (re-pointing a running ingest thread at a different file mid-
        # capture) is precisely the silent half-switch this task calls out as
        # unacceptable: the old `Supervisor` connection would keep writing
        # the old file while `/find` started reading a different one, and
        # nothing downstream would ever be told the two had diverged.
        # Refusing the `PUT` outright while a capture is running was the
        # other honest option; this one was chosen because `PUT /settings`
        # already has no idea whether a capture is running (it does not touch
        # `self.supervisor`), and teaching it to check would add a second
        # code path that has to agree with `Supervisor.status()` forever
        # after, for a field a player only ever needs to change between
        # sessions.
        self.journal_path = journal_path
        self.settings_path = settings_path
        # Injected so `/adapters` is testable without Wireshark installed —
        # tests supply a fake `find_dumpcap`/`probe_run` pair instead of
        # exercising a real subprocess. Production callers never pass these;
        # the defaults are the real functions `adapters.py` already exposes.
        self.find_dumpcap = find_dumpcap
        self.probe_run = probe_run
        # THE SUPERVISOR IS OWNED HERE, THE SAME WAY THE JOURNAL AND SETTINGS
        # PATHS ARE — one instance for the life of this process, no
        # module-level global. It cannot be built eagerly in this
        # constructor: which `dumpcap` to spawn depends on `settings.json`
        # (or a probe of `PATH`), and that can change — or simply not exist
        # yet on a fresh install — long after the server starts. So this
        # starts `None` and `Handler._get_or_create_supervisor` builds the
        # one real instance lazily, the first time `/capture/start` actually
        # has a `dumpcap` path to hand it. `supervisor_factory` is injected
        # the same way `find_dumpcap`/`probe_run` are: tests pass one that
        # ignores the resolved `dumpcap` argument and returns a `Supervisor`
        # pointed at a stub executable instead of a real `dumpcap.exe`. It
        # takes `self.journal_path` too — `(dumpcap, journal_path) ->
        # Supervisor` — which is what lets `_get_or_create_supervisor` wire
        # the one journal this server ever names into the Supervisor's
        # ingest loop; see `_default_supervisor_factory`.
        self.supervisor_factory = supervisor_factory
        self.supervisor: capture.Supervisor | None = None
        # Guards ONLY the lazy creation above — two overlapping `POST
        # /capture/start` requests both seeing `self.supervisor is None`
        # would otherwise create two distinct `Supervisor` instances, each
        # with its own "nothing running yet" state, and each would then
        # happily spawn its own `dumpcap` onto the same ring directory. That
        # is Finding 2 from `capture.py`, one layer up — see
        # `Supervisor.start`'s own lock for why a single shared instance is
        # not enough on its own; this lock is what guarantees there IS only
        # a single shared instance for that one to serialize against.
        self.supervisor_lock = threading.Lock()
        # ONE LOCK, SHARED ACROSS EVERY REQUEST. `ThreadingHTTPServer` hands
        # each connection its own thread and its own `Handler` instance, but
        # `settings.json` is one file on disk shared by all of them. Only one
        # client (the window) exists today, but it is entirely capable of
        # firing two `PUT`s close together (a fast double-save, a retry after
        # a slow response) — and without a lock around the load-merge-save,
        # the second read can happen before the first write lands, silently
        # dropping whatever the first `PUT` changed. The lock is held across
        # the whole read-modify-write, not just the write.
        self.settings_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    """GET /health, GET /find?q=, GET /players?q=, GET /player/<uid>, and GET /roster."""

    protocol_version = "HTTP/1.1"
    server_version = "dw-sidecar"
    server: _Server

    def log_message(self, format: str, *args: Any) -> None:
        """Silence. A search names a player being hunted, and that belongs in
        no log file — least of all one shipped to somebody else's machine."""

    def _send(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        if self.close_connection:
            # SETTING `close_connection` ALONE TELLS THE CLIENT NOTHING. It
            # only stops THIS SERVER from reading another request off the
            # socket after this one — a client that still believes this is
            # a live HTTP/1.1 keep-alive connection (every caller here,
            # `http.client` included) will happily try to send its next
            # request down the same socket and get a raw connection reset
            # instead of an HTTP response. `Connection: close` is what lets
            # a well-behaved client notice and open a fresh connection
            # instead of hitting that.
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            # Naming the journal AND saying what was found there is the
            # whole point: "no data yet" and "pointed at the wrong file"
            # look identical from the window, and only the second is
            # something the user can fix.
            state = journal_state(self.server.journal_path)
            self._send(
                200,
                {
                    "ok": state == READY,
                    "state": state,
                    "journal": str(self.server.journal_path),
                },
            )
            return
        if parsed.path == "/settings":
            # THE ENVIRONMENT MUST WIN HERE, same as everywhere else in this
            # app: what the window shows has to match what the sidecar will
            # actually use, and `main()` resolves the journal path the same
            # way — through `DW_SQLITE_PATH`, not just the file.
            file_only = settings.load(self.server.settings_path, environ={})
            effective = settings.load(self.server.settings_path, environ=os.environ)
            payload = _settings_to_camel(effective)
            # `pinnedByEnvironment` names the fields an environment variable
            # is currently overriding, so the window can say so instead of
            # letting the field just look like it silently ignored the
            # player when it inevitably reverts on the next fetch.
            payload["pinnedByEnvironment"] = _pinned_by_environment(file_only, effective)
            self._send(200, payload)
            return
        if parsed.path == "/adapters":
            # EVERY STATE HERE IS 200, including "no-dumpcap" and "failed".
            # A first run with no Npcap installed is a normal condition the
            # settings screen has to render, not a fetch failure — the HTTP
            # status answers "did the sidecar work", not "is a driver
            # installed".
            result = adapters.probe(self.server.find_dumpcap(), run=self.server.probe_run)
            self._send(
                200,
                {
                    "state": result.state,
                    "adapters": [
                        {"device": device, "label": label} for device, label in result.adapters
                    ],
                    "detail": result.detail,
                },
            )
            return
        if parsed.path == "/capture/status":
            # ALWAYS 200, same reasoning as `/adapters` above: a stopped or
            # never-started capture is a normal state the settings screen
            # has to render every time it loads, not a fetch failure.
            self._send_capture_status()
            return
        if parsed.path == "/players":
            self._handle_players_search(parsed)
            return
        if parsed.path.startswith("/player/"):
            self._handle_player_detail(parsed.path[len("/player/") :])
            return
        if parsed.path == "/roster":
            self._handle_roster()
            return

        if parsed.path != "/find":
            self._send(404, {"error": "no such endpoint"})
            return

        needle = (parse_qs(parsed.query).get("q") or [""])[0].strip()
        if not needle:
            # Otherwise an empty box returns the entire journal.
            self._send(400, {"error": "no uid or name given"})
            return

        state = journal_state(self.server.journal_path)
        if state != READY:
            # 503 rather than 500: nothing is wrong with the request. THE
            # FIRST RUN OF A FRESH INSTALL IS EXACTLY THIS CASE, and it has
            # to arrive as a sentence the window can show — not as a dropped
            # connection and a traceback on a stderr nobody is reading.
            self._send(503, {"error": "no journal to search yet", "state": state})
            return

        conn = sqlite3.connect(self.server.journal_path)
        try:
            found = localread.search(conn, needle)
        except sqlite3.DatabaseError as exc:
            # Between the check above and this query the file can be locked
            # by the collector writing to it, or turn out to be corrupt.
            self._send(
                503,
                {"error": f"could not read the journal: {exc}", "state": UNREADABLE},
            )
            return
        finally:
            conn.close()
        self._send(
            200,
            {
                "matches": [
                    tile_json(
                        game_uid=tile.game_uid,
                        server_id=tile.server_id,
                        name=tile.name,
                        x=tile.x,
                        y=tile.y,
                        hq_level=tile.hq_level,
                        captured_at=tile.captured_at,
                    )
                    for tile in found
                ]
            },
        )

    def _handle_players_search(self, parsed: ParseResult) -> None:
        """`GET /players?q=<uid or name>` — the player-search analogue of `/find`.

        FOLLOWS `/find` EXACTLY: same empty-needle 400, same journal-state
        503, same fresh-connection-per-request, same closed-in-`finally`.
        """
        needle = (parse_qs(parsed.query).get("q") or [""])[0].strip()
        if not needle:
            self._send(400, {"error": "no uid or name given"})
            return

        state = journal_state(self.server.journal_path)
        if state != READY:
            self._send(503, {"error": "no journal to search yet", "state": state})
            return

        conn = sqlite3.connect(self.server.journal_path)
        try:
            found = localread.search_players(conn, needle)
        except sqlite3.DatabaseError as exc:
            self._send(
                503,
                {"error": f"could not read the journal: {exc}", "state": UNREADABLE},
            )
            return
        finally:
            conn.close()
        self._send(200, {"matches": [player_json(profile) for profile in found]})

    def _handle_player_detail(self, raw_uid: str) -> None:
        """`GET /player/<uid>` — one profile, plus its power breakdown if any.

        THE PATH SEGMENT MUST BE ALL DIGITS. A uid is never anything else on
        the wire (see `player_json`), so a non-numeric segment is refused
        with a 400 rather than silently treated as a name — this endpoint
        takes a uid, not a search box.
        """
        raw_uid = raw_uid.strip()
        if not raw_uid or not raw_uid.isdigit():
            self._send(400, {"error": "the uid in the path must be a whole number"})
            return
        uid = int(raw_uid)

        state = journal_state(self.server.journal_path)
        if state != READY:
            self._send(503, {"error": "no journal to search yet", "state": state})
            return

        conn = sqlite3.connect(self.server.journal_path)
        try:
            profile = _player_by_uid(conn, uid)
            if profile is None:
                self._send(404, {"error": f"no profile has been seen for uid {uid}"})
                return
            detail = _detail_for(conn, server_id=profile.server_id, game_uid=profile.game_uid)
        except sqlite3.DatabaseError as exc:
            self._send(
                503,
                {"error": f"could not read the journal: {exc}", "state": UNREADABLE},
            )
            return
        finally:
            conn.close()

        self._send(
            200,
            {
                "profile": player_json(profile),
                "detail": player_detail_json(detail) if detail is not None else None,
            },
        )

    def _handle_roster(self) -> None:
        """`GET /roster` — the current alliance roster, newest snapshot only.

        FOLLOWS `/players` EXACTLY for the journal-state check, the fresh
        connection per request, and the closed-in-`finally` — see
        `_handle_players_search`. UNLIKE `/players` THIS TAKES NO QUERY: a
        roster is one fixed set of rows, not a search box, so there is
        nothing here to filter on.
        """
        state = journal_state(self.server.journal_path)
        if state != READY:
            self._send(503, {"error": "no journal to read yet", "state": state})
            return

        conn = sqlite3.connect(self.server.journal_path)
        try:
            entries = localread.roster(conn)
        except sqlite3.DatabaseError as exc:
            self._send(
                503,
                {"error": f"could not read the journal: {exc}", "state": UNREADABLE},
            )
            return
        finally:
            conn.close()
        self._send(200, roster_json(entries))

    def _read_json_object(self, max_bytes: int) -> dict[str, Any] | None:
        """The request body as a JSON object, or `None` after already
        sending a 400 with a sentence describing what was wrong.

        THIS MUST NEVER DROP THE CONNECTION. `/find`'s standard is a 400 and
        a reason, never a closed socket with a traceback on a stderr nobody
        reads — a malformed `PUT` body has to meet the same bar: not JSON at
        all, JSON that is not an object, a missing `Content-Length`, or a
        body bigger than any real settings payload could be.

        NOT DROPPING THE CONNECTION IS NOT THE SAME AS KEEPING IT ALIVE,
        THOUGH. `protocol_version` is HTTP/1.1, so unless told otherwise the
        socket is reused for the NEXT request too. Three of the branches
        below answer with a 400 before ever reading the declared body off
        the wire — we don't know how many bytes to read (no/invalid
        `Content-Length`), or we know and deliberately refuse to buffer that
        many (over the cap). In every one of those cases the body's bytes
        are still sitting unread in the socket, and the next thing read from
        it — the START OF THE FOLLOWING REQUEST — gets those leftover bytes
        prepended instead. The failure then shows up on a request that did
        nothing wrong (a `/health` poll, say), which is what makes this
        expensive to diagnose: nothing here looks broken, the NEXT caller
        does. `self.close_connection = True` on those three paths is what
        keeps a refused body from becoming garbage on someone else's
        request; the later failures below (bad UTF-8, bad JSON, not an
        object) happen only after `self.rfile.read(length)` has already
        consumed exactly the declared body, so the socket is still in sync
        and does not need this.
        """
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            # WITHOUT THIS CHECK, `self.rfile.read(length)` BELOW WOULD NEED
            # A LENGTH TO READ. There is no length-less body framing this
            # handler understands (no chunked transfer support), so a
            # request that omits the header is refused outright rather than
            # guessed at. There is no length to read BY, either — whatever
            # body bytes the client sent are unread and about to poison the
            # next request on this connection unless it is closed now.
            self.close_connection = True
            self._send(400, {"error": "missing Content-Length"})
            return None
        try:
            length = int(raw_length)
        except ValueError:
            # An unparseable header means the declared length is unknown, so
            # — same as the missing-header case above — there is no correct
            # number of bytes to drain before answering. Close rather than
            # guess.
            self.close_connection = True
            self._send(400, {"error": "invalid Content-Length"})
            return None
        if length < 0 or length > max_bytes:
            # The length IS known here, but reading it just to throw it away
            # would defeat the point of refusing it before buffering. That
            # means these bytes are left on the wire, so the connection must
            # close — a 400 that leaves bytes behind is worse than the
            # dropped connection this whole method exists to avoid.
            self.close_connection = True
            self._send(400, {"error": f"body too large (max {max_bytes} bytes)"})
            return None

        raw_body = self.rfile.read(length)
        try:
            text = raw_body.decode("utf-8")
        except UnicodeDecodeError:
            self._send(400, {"error": "body is not valid UTF-8"})
            return None
        try:
            parsed_body = json.loads(text)
        except json.JSONDecodeError:
            self._send(400, {"error": "body is not valid JSON"})
            return None
        if not isinstance(parsed_body, dict):
            self._send(400, {"error": "body must be a JSON object"})
            return None
        return parsed_body

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/settings":
            # THE BODY IS STILL SITTING UNREAD ON THE WIRE HERE. This branch
            # answers before even looking at `Content-Length`, so a `PUT`
            # with a body aimed at any other path leaves that body to be
            # read as the start of the next request on this HTTP/1.1
            # connection — the same desync `_read_json_object` guards
            # against, just one step earlier.
            self.close_connection = True
            self._send(404, {"error": "no such endpoint"})
            return

        body = self._read_json_object(_MAX_SETTINGS_BODY)
        if body is None:
            # `_read_json_object` already sent the 400, said why, and closed
            # the connection itself where the body was left unread.
            return

        # ONE LOCK ACROSS THE WHOLE READ-MODIFY-WRITE. `ThreadingHTTPServer`
        # runs each connection on its own thread, and without this two
        # concurrent `PUT`s can interleave: both read the same "current",
        # both merge their own change onto it, and whichever writes second
        # wins outright — the first edit is gone with no error anywhere.
        # See `_Server.__init__` for why one client today does not make this
        # unnecessary.
        with self.server.settings_lock:
            # MERGED ONTO THE FILE, NOT ONTO WHAT `load` WOULD RETURN. Loading
            # with an empty `environ` is exactly `settings.load`'s own idiom
            # for "the file only, no environment" (see
            # `test_desktop_settings.py`). Merging onto a real
            # `os.environ`-applied value would let an environment variable on
            # THIS machine get baked into the file the next time anyone
            # touches Settings from the window — precisely the trap
            # `ensure_collector_id` was already checked for: the file must
            # only ever record what a person (or the window) actually chose
            # to persist, never what the environment happened to be
            # supplying today.
            current = settings.load(self.server.settings_path, environ={})
            merged = _merge_settings_body(current, body)
            settings.save(self.server.settings_path, merged)
        # THE RESPONSE IS THE EFFECTIVE SETTINGS, NOT THE FILE-ONLY ONES —
        # deliberately different from what was just written to disk. If
        # `DW_CAPTURE_DIR` (or any other overridable field) is set on this
        # machine, echoing back the bare file would show the player their
        # own edit, and then the very next `GET /settings` (which already
        # applies the environment) would show it reverted with no
        # explanation. Answering with what the sidecar will ACTUALLY use —
        # same as `GET` — means what the window shows after saving is what
        # it will show on the next fetch too.
        effective = settings.load(self.server.settings_path, environ=os.environ)
        payload = _settings_to_camel(effective)
        payload["pinnedByEnvironment"] = _pinned_by_environment(merged, effective)
        self._send(200, payload)

    def _drain_request_body(self) -> None:
        """Read and discard whatever body accompanies this request, if any.

        Same desync `_read_json_object` guards against on `PUT /settings`:
        `protocol_version` is HTTP/1.1, so the connection is reused, and
        unread bytes become the start of the next request. Neither capture
        endpoint takes a body, but nothing stops a caller from sending
        `fetch(url, {method: "POST", body: "{}"})` anyway — drained and
        ignored either way, never parsed.
        """
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return
        try:
            length = int(raw_length)
        except ValueError:
            return
        if length > 0:
            self.rfile.read(length)

    def _send_capture_status(self) -> None:
        """200, always — the shape `/capture/start` and `/capture/stop`
        answer with too, per their own docstrings."""
        status = (
            self.server.supervisor.status()
            if self.server.supervisor is not None
            else capture.CaptureStatus(state="stopped")
        )
        effective = settings.load(self.server.settings_path, environ=os.environ)
        files = _count_pcapng_files(effective.capture_dir)
        rows = _cheap_row_count(self.server.journal_path)
        self._send(200, capture_status_json(status, files=files, rows=rows))

    def _get_or_create_supervisor(self, dumpcap_path: str) -> capture.Supervisor:
        """The one `Supervisor` this server will ever use, built the first
        time a `dumpcap` path is actually known. See `_Server.__init__` for
        why this cannot happen any earlier, and why the lock around it is
        not optional.

        `self.server.journal_path` IS PASSED HERE, NOT `effective.journal_path`
        FROM SETTINGS. That is the fix for the gap this task closes — without
        it the factory builds a `Supervisor(journal_path=None)`, which is
        production's default for "no ingest thread at all" (see
        `capture.Supervisor.__init__`). It is also `_Server.__init__`'s
        documented answer to what a `PUT /settings` journal-path change does
        to a running capture: nothing, until this process restarts — the
        Supervisor this method builds is bound to whichever path was true
        when THIS process started, forever, the same as `/health` and
        `/find` already are.
        """
        with self.server.supervisor_lock:
            if self.server.supervisor is None:
                self.server.supervisor = self.server.supervisor_factory(
                    dumpcap_path, self.server.journal_path
                )
            return self.server.supervisor

    def do_POST(self) -> None:
        self._drain_request_body()
        parsed = urlparse(self.path)
        if parsed.path == "/capture/start":
            self._handle_capture_start()
            return
        if parsed.path == "/capture/stop":
            self._handle_capture_stop()
            return
        self.close_connection = True
        self._send(404, {"error": "no such endpoint"})

    def _handle_capture_start(self) -> None:
        """Start capture against the CURRENT effective settings.

        Every refusal here is a 400 with a full sentence, checked and
        answered BEFORE anything is spawned — never a bare error code, and
        never a `dumpcap` launched on a configuration already known to be
        bad. The window shows these strings verbatim to somebody who cannot
        read a stack trace, so each one names exactly what is missing and,
        where there is one, the fix.
        """
        effective = settings.load(self.server.settings_path, environ=os.environ)
        if not effective.interface:
            # A fresh install's state: no adapter has been picked yet, and
            # `dumpcap -i ""` is nonsense `Supervisor.start` would otherwise
            # have to reject one layer down, after already being asked to
            # spawn.
            self._send(
                400,
                {
                    "error": "No capture interface is configured. Pick one on "
                    "the settings screen before starting capture."
                },
            )
            return
        dumpcap_path = effective.dumpcap_path or self.server.find_dumpcap()
        if not dumpcap_path:
            # Say what is actually missing — the driver, not a path — same
            # reasoning as `/adapters`' "no-dumpcap" state.
            self._send(
                400,
                {"error": "dumpcap was not found. Install Npcap or Wireshark, then try again."},
            )
            return
        if not effective.capture_dir:
            self._send(
                400,
                {
                    "error": "No capture directory is configured. Choose one on "
                    "the settings screen before starting capture."
                },
            )
            return

        supervisor = self._get_or_create_supervisor(dumpcap_path)
        try:
            supervisor.start(
                effective.interface, Path(effective.capture_dir), game_port=effective.game_port
            )
        except ValueError as exc:
            # `Supervisor.start`'s own guard (an empty interface) — not
            # reachable given the check above, but caught rather than left
            # to surface as an unhandled 500 if that ever changes.
            self._send(400, {"error": str(exc)})
            return
        self._send_capture_status()

    def _handle_capture_stop(self) -> None:
        """Stop capture. A stop when nothing is running is 200, not an
        error — see `capture.Supervisor.stop`'s own docstring; a player
        pressing Stop twice has done nothing wrong."""
        if self.server.supervisor is not None:
            self.server.supervisor.stop()
        self._send_capture_status()


def serve(
    journal_path: Path,
    settings_path: Path | None = None,
    *,
    port: int = 0,
    find_dumpcap: Callable[[], str | None] = adapters.find_dumpcap,
    probe_run: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
    supervisor_factory: Callable[[str, Path], capture.Supervisor] = _default_supervisor_factory,
) -> _Server:
    """A started server. The caller owns `serve_forever` and shutdown.

    `settings_path` DEFAULTS NEXT TO THE JOURNAL rather than making every
    caller invent one — callers that only care about `/health` and `/find`
    (every one of them written before this task) keep calling
    `serve(journal_path, port=0)` unchanged and still get an isolated
    `settings.json` for free.

    Returns `_Server`, not the bare `ThreadingHTTPServer` this used to
    declare — every caller already gets one back in practice, and
    `_stop_when_stdin_closes` needs the narrower type to reach
    `.supervisor` without a cast.
    """
    resolved_settings_path = (
        settings_path if settings_path is not None else journal_path.with_name("settings.json")
    )
    return _Server(
        (HOST, port),
        journal_path,
        resolved_settings_path,
        find_dumpcap=find_dumpcap,
        probe_run=probe_run,
        supervisor_factory=supervisor_factory,
    )


def _stop_capture(httpd: _Server) -> None:
    """Stop whatever `dumpcap` child this server's `Supervisor` owns, if one
    was ever started.

    THE ORPHAN GUARD, ONE LEVEL FURTHER DOWN. `docs/runbooks/desktop-sidecar-
    lifecycle.md` already covers Rust dying without cleaning up this
    process; this is the same failure shape one hop lower. `dumpcap` is now
    a child of THIS process, not of Rust, so a sidecar that exits without
    stopping it leaves a capture running with no window and nothing reading
    its files — the exact orphan this whole guard exists to prevent, just
    one process further from the surface.

    Called from every path that ends this process — see `main`'s `finally`
    and `_stop_when_stdin_closes` below — so a crash, an interrupt, and the
    ordinary stdin-EOF shutdown all reach it. `Supervisor.stop()` is already
    a safe no-op when nothing is running, so calling this more than once (as
    `_stop_when_stdin_closes` and `main`'s `finally` both do on the ordinary
    shutdown path) costs nothing.
    """
    if httpd.supervisor is not None:
        httpd.supervisor.stop()


def _stop_when_stdin_closes(httpd: _Server) -> None:
    """Shut down once the parent's pipe reaches EOF.

    THE PIPE CLOSING IS THE DEATH SIGNAL. Rust kills this process on a clean
    exit, and that covers the ordinary close; this is the other half, for
    every path Rust never reaches — a panic, or the window being killed from
    Task Manager. Without it the window disappears and a Python process
    keeps running, holding the journal open, with nothing on screen to say
    so.

    Rust holds this pipe open and deliberately never writes to it, so the
    read below blocks forever until the parent goes away.
    """
    if sys.stdin is None:
        # No pipe to watch. Only reachable when something starts this
        # without stdin at all, in which case Rust is not the parent and the
        # guard has nothing to guard.
        return
    try:
        while sys.stdin.readline():
            pass
    except (OSError, ValueError):
        # A closed or invalidated handle means the same thing as EOF.
        pass
    # STOP DUMPCAP BEFORE SHUTTING THE SERVER DOWN, NOT AFTER. This thread
    # already knows the parent is gone; there is no reason to wait for
    # `serve_forever` to notice and unwind into `main`'s `finally` before
    # killing a capture that is, by definition, orphaned the moment this
    # line runs. `main`'s `finally` still calls this again as a backstop for
    # every OTHER way the process can end — see `_stop_capture`.
    _stop_capture(httpd)
    # From another thread on purpose: `shutdown` deadlocks if called on the
    # thread running `serve_forever`.
    httpd.shutdown()


def main(argv: list[str] | None = None) -> int:
    """Run the sidecar until the parent goes away.

    The journal path comes from the command line when Rust starts this, and
    from `DW_SQLITE_PATH` when a person does — the same variable the rest of
    the collector already reads.
    """
    args = sys.argv[1:] if argv is None else list(argv)
    journal_path = (
        Path(args[0]) if args else Path(os.environ.get("DW_SQLITE_PATH", "./data/collector.db"))
    )

    httpd = serve(journal_path, port=0)
    # FIRST LINE, WITH NOTHING BEFORE IT. Rust reads exactly one line to
    # learn the port, so anything printed earlier is read as the port and
    # the window never finds the sidecar.
    print(f"PORT {httpd.server_address[1]}", flush=True)

    threading.Thread(target=_stop_when_stdin_closes, args=(httpd,), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        # Only reachable when a person is running this by hand. The guard
        # thread is the normal way out, and it exits 0 — an interrupt is the
        # same intent typed differently, so it should not look like a crash.
        pass
    finally:
        # THE BACKSTOP. Every path out of this function — the ordinary
        # stdin-EOF shutdown, a `KeyboardInterrupt`, or any exception
        # `serve_forever` does not swallow — runs this `finally` on the way
        # out, which is what makes it the one place guaranteed to catch
        # whatever `_stop_when_stdin_closes` did not already handle. See
        # `_stop_capture`.
        _stop_capture(httpd)
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
