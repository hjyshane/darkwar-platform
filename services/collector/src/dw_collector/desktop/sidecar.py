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
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from dw_collector.desktop import localread

HOST = "127.0.0.1"


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
            # Naming the journal makes "no data yet" distinguishable from
            # "pointed at the wrong file", and only the second is fixable.
            self._send(200, {"ok": True, "journal": str(self.server.journal_path)})
            return
        if parsed.path != "/find":
            self._send(404, {"error": "no such endpoint"})
            return

        needle = (parse_qs(parsed.query).get("q") or [""])[0].strip()
        if not needle:
            # Otherwise an empty box returns the entire journal.
            self._send(400, {"error": "no uid or name given"})
            return

        conn = sqlite3.connect(self.server.journal_path)
        try:
            found = localread.search(conn, needle)
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
