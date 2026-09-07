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
from urllib.parse import parse_qs, urlparse

from dw_collector.desktop import adapters, localread, settings

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
    ) -> None:
        super().__init__(address, Handler)
        self.journal_path = journal_path
        self.settings_path = settings_path
        # Injected so `/adapters` is testable without Wireshark installed —
        # tests supply a fake `find_dumpcap`/`probe_run` pair instead of
        # exercising a real subprocess. Production callers never pass these;
        # the defaults are the real functions `adapters.py` already exposes.
        self.find_dumpcap = find_dumpcap
        self.probe_run = probe_run
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
    """GET /health and GET /find?q=<uid or name>."""

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


def serve(
    journal_path: Path,
    settings_path: Path | None = None,
    *,
    port: int = 0,
    find_dumpcap: Callable[[], str | None] = adapters.find_dumpcap,
    probe_run: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> ThreadingHTTPServer:
    """A started server. The caller owns `serve_forever` and shutdown.

    `settings_path` DEFAULTS NEXT TO THE JOURNAL rather than making every
    caller invent one — callers that only care about `/health` and `/find`
    (every one of them written before this task) keep calling
    `serve(journal_path, port=0)` unchanged and still get an isolated
    `settings.json` for free.
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
    )


def _stop_when_stdin_closes(httpd: ThreadingHTTPServer) -> None:
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
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
