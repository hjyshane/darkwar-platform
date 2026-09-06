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
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from dw_collector.desktop import localread

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


class _Server(ThreadingHTTPServer):
    """Carries the journal path so the handler can read it off `self.server`.

    A handler class attribute set with `type(...)` per call is one more thing
    for mypy --strict to be unhappy about typing; the server the stdlib
    already threads through to every handler instance has no such problem.
    """

    def __init__(self, address: tuple[str, int], journal_path: Path) -> None:
        super().__init__(address, Handler)
        self.journal_path = journal_path


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


def serve(journal_path: Path, *, port: int = 0) -> ThreadingHTTPServer:
    """A started server. The caller owns `serve_forever` and shutdown."""
    return _Server((HOST, port), journal_path)


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
