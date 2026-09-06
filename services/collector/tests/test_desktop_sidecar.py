"""The sidecar: an HTTP surface over the local journal.

Only Rust ever calls this, over loopback, so there is no CORS and no auth —
the security property comes from the port never leaving the machine.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from threading import Thread

import pytest

from dw_collector.desktop import sidecar
from dw_collector.storage.journal import Journal


@pytest.fixture
def base(tmp_path: Path) -> Iterator[str]:
    """A started sidecar on a port the OS picks, over an empty journal."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_health_says_which_journal_it_opened(base: str) -> None:
    # The window shows this. "No data yet" and "pointed at the wrong file"
    # look identical otherwise, and only the second is fixable.
    with urllib.request.urlopen(f"{base}/health") as response:
        body = json.loads(response.read())
    assert body["ok"] is True
    assert body["journal"].endswith("collector.db")


def test_find_returns_an_empty_list_for_an_empty_journal(base: str) -> None:
    with urllib.request.urlopen(f"{base}/find?q=erha") as response:
        body = json.loads(response.read())
    assert body["matches"] == []


def test_a_uid_crosses_as_a_string_so_it_cannot_round() -> None:
    """Number.MAX_SAFE_INTEGER is sixteen digits and so is a uid.

    A uid serialized as a JSON number is one order of magnitude from
    becoming a DIFFERENT uid, which is a confident answer about the wrong
    player rather than a typo anyone would spot.
    """
    tile = sidecar.tile_json(
        game_uid=1190060554000581,
        server_id=581,
        name="ERHA",
        x=1,
        y=2,
        hq_level=34,
        captured_at="2026-09-01T10:00:00+00:00",
    )
    assert tile["gameUid"] == "1190060554000581"
    assert json.loads(json.dumps(tile))["gameUid"] == "1190060554000581"


def test_an_empty_needle_is_refused(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/find?q=%20")
    assert raised.value.code == 400


def test_an_unknown_endpoint_is_a_404(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/nope")
    assert raised.value.code == 404


def test_a_real_tile_comes_back_through_the_endpoint(tmp_path: Path) -> None:
    """End to end: a row in the journal, out through JSON."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'world.get.new', "
        "'2026-09-01T10:00:00+00:00', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', 'world_city_snapshots', 'k', ?, 't')",
        (
            json.dumps(
                {
                    "row": {
                        "game_uid": 1190060554000581,
                        "server_id": 581,
                        "name": "ERHA SANGMAIMA",
                        "x": 310,
                        "y": 622,
                        "hq_level": 34,
                    }
                }
            ),
        ),
    )
    journal.conn.commit()
    journal.close()

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/find?q=sangmai"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert len(body["matches"]) == 1
    hit = body["matches"][0]
    assert hit["gameUid"] == "1190060554000581"
    assert (hit["x"], hit["y"]) == (310, 622)
    assert hit["capturedAt"] == "2026-09-01T10:00:00+00:00"


def test_a_missing_journal_is_reported_and_not_created(tmp_path: Path) -> None:
    """The state every new install starts in.

    And the file must still not exist afterwards: `sqlite3.connect` creates
    one, so an endpoint that connects before checking turns a wrong path
    into a permanent empty journal.
    """
    missing = tmp_path / "not-here.db"
    httpd = sidecar.serve(missing, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        with urllib.request.urlopen(f"{url}/health") as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert body["ok"] is False
    assert body["state"] == sidecar.NO_JOURNAL
    assert not missing.exists()


def test_find_on_a_missing_journal_answers_rather_than_dropping(
    tmp_path: Path,
) -> None:
    """It used to send NOTHING — the client saw the socket close, with a
    traceback on a stderr nobody reads. A fresh install hits this first."""
    missing = tmp_path / "not-here.db"
    httpd = sidecar.serve(missing, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/find?q=erha"
        with pytest.raises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(url)
        code = raised.value.code
        body = json.loads(raised.value.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert code == 503
    assert body["state"] == sidecar.NO_JOURNAL
    assert not missing.exists()


def test_a_file_that_is_not_a_journal_is_unreadable_not_empty(
    tmp_path: Path,
) -> None:
    """An empty result and an unopenable file must not look the same."""
    impostor = tmp_path / "collector.db"
    impostor.write_text("this is not a database", encoding="utf-8")

    httpd = sidecar.serve(impostor, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        with urllib.request.urlopen(f"{url}/health") as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert body["ok"] is False
    assert body["state"] == sidecar.UNREADABLE


def test_a_journal_with_its_schema_is_ready(tmp_path: Path) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        with urllib.request.urlopen(f"{url}/health") as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert body["ok"] is True
    assert body["state"] == sidecar.READY
