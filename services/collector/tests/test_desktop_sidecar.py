"""The sidecar: an HTTP surface over the local journal.

Only Rust ever calls this, over loopback, so there is no CORS and no auth —
the security property comes from the port never leaving the machine.
"""

from __future__ import annotations

import http.client
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

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


@dataclass
class _SidecarWithSettings:
    """Like `base`, but exposes the settings file path too, for tests that
    need to seed or inspect it directly rather than only round-trip HTTP."""

    url: str
    settings_path: Path


@pytest.fixture
def settings_sidecar(tmp_path: Path) -> Iterator[_SidecarWithSettings]:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    settings_path = tmp_path / "settings.json"
    httpd = sidecar.serve(journal_path, settings_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield _SidecarWithSettings(
            url=f"http://127.0.0.1:{httpd.server_address[1]}", settings_path=settings_path
        )
    finally:
        httpd.shutdown()
        httpd.server_close()


def _put_settings(url: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    """PUT `payload` to `{url}/settings` and return `(status, body)` even on
    a 4xx — `urlopen` raises `HTTPError` for those, and every caller here
    wants the body either way."""
    request = urllib.request.Request(
        f"{url}/settings",
        data=json.dumps(payload).encode("utf-8"),
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def test_get_settings_returns_camelcase_defaults(settings_sidecar: _SidecarWithSettings) -> None:
    with urllib.request.urlopen(f"{settings_sidecar.url}/settings") as response:
        body = json.loads(response.read())
    assert body == {
        "journalPath": "",
        "captureDir": "",
        "interface": "",
        "dumpcapPath": "",
        "serverId": 580,
        "gamePort": 8680,
        "collectorId": "",
        "pinnedByEnvironment": [],
    }


def test_get_settings_applies_the_environment_over_the_file(
    settings_sidecar: _SidecarWithSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`/settings` must show what the sidecar will actually use, and the
    environment always wins over the file — same rule as `settings.load`."""
    settings_sidecar.settings_path.write_text(json.dumps({"server_id": 581}), encoding="utf-8")
    monkeypatch.setenv("DW_COLLECTOR_SERVER_ID", "584")
    with urllib.request.urlopen(f"{settings_sidecar.url}/settings") as response:
        body = json.loads(response.read())
    assert body["serverId"] == 584


def test_get_settings_pins_nothing_when_the_environment_is_unset(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    with urllib.request.urlopen(f"{settings_sidecar.url}/settings") as response:
        body = json.loads(response.read())
    assert body["pinnedByEnvironment"] == []


def test_get_settings_pins_the_field_the_environment_overrides(
    settings_sidecar: _SidecarWithSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """So the window can say "this is set by your environment" instead of
    letting the field just look like it silently ignores the player."""
    monkeypatch.setenv("DW_CAPTURE_DIR", "C:/captures")
    with urllib.request.urlopen(f"{settings_sidecar.url}/settings") as response:
        body = json.loads(response.read())
    assert body["pinnedByEnvironment"] == ["captureDir"]


def test_put_settings_saves_and_echoes_back_what_was_saved(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    status, body = _put_settings(
        settings_sidecar.url, {"journalPath": "C:/data/collector.db", "serverId": 581}
    )
    assert status == 200
    assert body["journalPath"] == "C:/data/collector.db"
    assert body["serverId"] == 581
    # And it actually landed on disk, not just in the response.
    on_disk = json.loads(settings_sidecar.settings_path.read_text(encoding="utf-8"))
    assert on_disk["journal_path"] == "C:/data/collector.db"
    assert on_disk["server_id"] == 581


def test_put_settings_ignores_unknown_fields(settings_sidecar: _SidecarWithSettings) -> None:
    """A newer window must be able to talk to an older sidecar — the same
    reason `settings.load` ignores an unknown key from the file."""
    status, body = _put_settings(
        settings_sidecar.url, {"serverId": 583, "someFutureField": "whatever"}
    )
    assert status == 200
    assert body["serverId"] == 583
    assert "someFutureField" not in body


def test_put_settings_never_writes_the_collector_id(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    """THE COLLECTOR ID IS NOT EDITABLE FROM THE WIRE.

    It is one of five components hashed into the journal's unique
    `idempotency_key` (see `settings.ensure_collector_id`). If a `PUT` could
    change it, a stale value cached in the window, or a settings file synced
    from another machine, would silently re-key every row the collector has
    ever written — turning a journal full of correctly-deduplicated history
    into a pile of "new" duplicates on the very next capture. `PUT` must
    preserve whatever collector id is already on disk no matter what the
    request body asks for.
    """
    settings_sidecar.settings_path.write_text(
        json.dumps({"collector_id": "original-id"}), encoding="utf-8"
    )

    status, body = _put_settings(
        settings_sidecar.url, {"collectorId": "attacker-supplied-id", "serverId": 582}
    )

    assert status == 200
    assert body["collectorId"] == "original-id"
    assert body["serverId"] == 582
    on_disk = json.loads(settings_sidecar.settings_path.read_text(encoding="utf-8"))
    assert on_disk["collector_id"] == "original-id"


def test_put_settings_response_reflects_the_environment_not_just_the_file(
    settings_sidecar: _SidecarWithSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE PLAYER MUST NOT WATCH THEIR OWN EDIT REVERT.

    `GET /settings` already applies the environment on top of the file. If
    `PUT`'s response echoed the file alone, a player on a machine with
    `DW_CAPTURE_DIR` set would save, see their typed value for a heartbeat,
    then have the very next fetch show something else with no explanation.
    Answering with the same effective (environment-applied) view `GET` uses
    means what the window shows right after saving is what it will keep
    showing.
    """
    monkeypatch.setenv("DW_CAPTURE_DIR", "C:/env-capture-dir")
    status, body = _put_settings(settings_sidecar.url, {"serverId": 581})
    assert status == 200
    assert body["captureDir"] == "C:/env-capture-dir"
    assert body["pinnedByEnvironment"] == ["captureDir"]


def test_put_settings_never_bakes_the_environment_into_the_file(
    settings_sidecar: _SidecarWithSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE FILE MUST NEVER RECORD WHAT THE ENVIRONMENT WAS SUPPLYING TODAY.

    This is the property the whole endpoint is built around — `do_PUT` loads
    the current file with `environ={}` and merges onto THAT, never onto the
    environment-applied view, precisely so an environment variable on this
    machine can never get written into `settings.json` for every future
    machine that reads it. Until now that guarantee was proven only by a
    comment and a manual experiment; this reads the file back off disk,
    not just the HTTP response, so a regression that merges onto the wrong
    base cannot hide behind a response that merely looks right.
    """
    monkeypatch.setenv("DW_CAPTURE_DIR", "C:/env-only-capture-dir")
    monkeypatch.setenv("DW_COLLECTOR_SERVER_ID", "999")

    status, _ = _put_settings(settings_sidecar.url, {"journalPath": "C:/data/collector.db"})
    assert status == 200

    on_disk_text = settings_sidecar.settings_path.read_text(encoding="utf-8")
    assert "C:/env-only-capture-dir" not in on_disk_text
    assert "999" not in on_disk_text


def test_put_settings_rejects_a_body_that_is_not_json(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    request = urllib.request.Request(
        f"{settings_sidecar.url}/settings", data=b"not json at all", method="PUT"
    )
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(request)
    assert raised.value.code == 400
    body = json.loads(raised.value.read())
    assert body.get("error")


def test_put_settings_rejects_json_that_is_not_an_object(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    request = urllib.request.Request(
        f"{settings_sidecar.url}/settings",
        data=json.dumps([1, 2, 3]).encode("utf-8"),
        method="PUT",
    )
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(request)
    assert raised.value.code == 400
    body = json.loads(raised.value.read())
    assert body.get("error")


def test_put_settings_rejects_a_missing_content_length(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    """A malformed body must be a 400 with a sentence, never a dropped
    connection — the same standard `/find` already meets."""
    parsed = urlparse(settings_sidecar.url)
    assert parsed.hostname is not None
    assert parsed.port is not None
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port)
    try:
        conn.putrequest("PUT", "/settings", skip_host=True)
        conn.endheaders()
        response = conn.getresponse()
        body = json.loads(response.read())
        assert response.status == 400
        assert body.get("error")
    finally:
        conn.close()


def test_put_settings_rejects_a_body_over_the_cap(
    settings_sidecar: _SidecarWithSettings,
) -> None:
    oversized = "x" * 200_000
    request = urllib.request.Request(
        f"{settings_sidecar.url}/settings",
        data=json.dumps({"journalPath": oversized}).encode("utf-8"),
        method="PUT",
    )
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(request)
    assert raised.value.code == 400
    body = json.loads(raised.value.read())
    assert body.get("error")


def test_a_refused_put_does_not_poison_the_next_request(base: str) -> None:
    """A 400 THAT LEAVES BYTES IN THE SOCKET IS WORSE THAN A DROPPED ONE.

    `protocol_version` is HTTP/1.1, so the connection is reused. An error
    path that answers without draining the body leaves the rest of it to be
    read as the start of the NEXT request — and the failure then lands on a
    request that did nothing wrong, which is what makes it expensive to find.
    """
    parsed = urlparse(base)
    assert parsed.hostname is not None
    assert parsed.port is not None

    # Case 1: oversized body. `http.client` computes Content-Length itself,
    # so this exercises the "known length, refused before reading it" path.
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port)
    try:
        oversized = json.dumps({"journalPath": "x" * 200_000}).encode("utf-8")
        conn.request("PUT", "/settings", body=oversized)
        refusal = conn.getresponse()
        assert refusal.status == 400
        refusal.read()

        # SAME `HTTPConnection` OBJECT. If the sidecar left the connection
        # looking alive without saying so, this either reads a poisoned
        # response (a stray `414` from the leftover bytes, or garbage) or
        # blows up outright. A server that closed the connection AND said
        # so via `Connection: close` lets `http.client` reconnect on its own
        # and this just works.
        conn.request("GET", "/health")
        follow_up = conn.getresponse()
        follow_up_body = json.loads(follow_up.read())
        assert follow_up.status == 200
        assert "ok" in follow_up_body
    finally:
        conn.close()

    # Case 2: no Content-Length at all — the "unknown length" path.
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port)
    try:
        conn.putrequest("PUT", "/settings", skip_host=True)
        conn.endheaders()
        refusal = conn.getresponse()
        assert refusal.status == 400
        refusal.read()

        conn.request("GET", "/health")
        follow_up = conn.getresponse()
        follow_up_body = json.loads(follow_up.read())
        assert follow_up.status == 200
        assert "ok" in follow_up_body
    finally:
        conn.close()


def _fake_completed(
    *, returncode: int, stdout: bytes = b"", stderr: bytes = b""
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(
        args=["dumpcap", "-D"], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_adapters_no_dumpcap_is_200_not_an_error(tmp_path: Path) -> None:
    """A first run with no Npcap installed is a normal state the settings
    screen must be able to render, not a fetch failure."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(
        journal_path, tmp_path / "settings.json", port=0, find_dumpcap=lambda: None
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/adapters"
        with urllib.request.urlopen(url) as response:
            status = response.status
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert status == 200
    assert body == {"state": "no-dumpcap", "adapters": [], "detail": ""}


def test_adapters_ready_lists_devices_from_a_fake_dumpcap(tmp_path: Path) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    stdout = rb"1. \Device\NPF_{GUID} (Wi-Fi)" + b"\n"
    httpd = sidecar.serve(
        journal_path,
        tmp_path / "settings.json",
        port=0,
        find_dumpcap=lambda: "fake-dumpcap",
        probe_run=lambda *args, **kwargs: _fake_completed(returncode=0, stdout=stdout),
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/adapters"
        with urllib.request.urlopen(url) as response:
            status = response.status
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert status == 200
    assert body == {
        "state": "ready",
        "adapters": [{"device": r"\Device\NPF_{GUID}", "label": "Wi-Fi"}],
        "detail": "",
    }


def test_adapters_failed_is_200_and_carries_dumpcaps_own_words(tmp_path: Path) -> None:
    """200, not 500 — dumpcap failing is a normal outcome the screen has to
    show (Npcap missing, a driver refusal, ...), not a sidecar bug. WE DO
    NOT GUESS AT THE CAUSE; the message is dumpcap's own, verbatim."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(
        journal_path,
        tmp_path / "settings.json",
        port=0,
        find_dumpcap=lambda: "fake-dumpcap",
        probe_run=lambda *args, **kwargs: _fake_completed(
            returncode=1, stderr=b"Npcap is not installed"
        ),
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/adapters"
        with urllib.request.urlopen(url) as response:
            status = response.status
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert status == 200
    assert body == {"state": "failed", "adapters": [], "detail": "Npcap is not installed"}


def test_adapters_no_adapters_when_dumpcap_lists_none(tmp_path: Path) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(
        journal_path,
        tmp_path / "settings.json",
        port=0,
        find_dumpcap=lambda: "fake-dumpcap",
        probe_run=lambda *args, **kwargs: _fake_completed(returncode=0, stdout=b""),
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/adapters"
        with urllib.request.urlopen(url) as response:
            status = response.status
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert status == 200
    assert body == {"state": "no-adapters", "adapters": [], "detail": ""}


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


def test_closing_stdin_stops_the_process(tmp_path: Path) -> None:
    """THE ORPHAN GUARD.

    If Rust dies without cleaning up — a panic, or being killed from Task
    Manager — the only thing left telling this process anything is its own
    stdin reaching EOF. A sidecar that ignores that keeps holding the
    journal open with no window attached, which is the same shape as the
    phantom scheduled task this repo has already chased once.
    """
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    child = subprocess.Popen(
        [sys.executable, "-m", "dw_collector.desktop.sidecar", str(journal_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    announced = child.stdout.readline().strip()
    assert announced.startswith("PORT ")

    assert child.stdin is not None
    child.stdin.close()

    # Generous, because process teardown on Windows is not instant.
    for _ in range(50):
        if child.poll() is not None:
            break
        time.sleep(0.1)
    if child.poll() is None:
        child.kill()
        child.wait(timeout=10)
        pytest.fail("sidecar outlived its parent's stdin")


def test_the_port_is_announced_on_the_first_line(tmp_path: Path) -> None:
    """Rust reads exactly ONE line to learn where to connect, so nothing may
    be printed before it — not a banner, not a warning, not a log line."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    child = subprocess.Popen(
        [sys.executable, "-m", "dw_collector.desktop.sidecar", str(journal_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    port = int(child.stdout.readline().strip().removeprefix("PORT "))
    assert 1024 < port < 65536

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health") as response:
        assert json.loads(response.read())["ok"] is True

    assert child.stdin is not None
    child.stdin.close()
    child.wait(timeout=10)


def test_the_journal_path_can_come_from_the_environment(tmp_path: Path) -> None:
    """Rust passes the path as an argument, but `DW_SQLITE_PATH` is how the
    rest of the collector is configured, and it is the only way to run this
    by hand against a real journal. An untested fallback is one that quietly
    points at `./data/collector.db` forever.
    """
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    child = subprocess.Popen(
        [sys.executable, "-m", "dw_collector.desktop.sidecar"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "DW_SQLITE_PATH": str(journal_path)},
    )
    try:
        assert child.stdout is not None
        port = int(child.stdout.readline().strip().removeprefix("PORT "))
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health") as response:
            body = json.loads(response.read())
        assert body["journal"] == str(journal_path)
        assert body["state"] == sidecar.READY
    finally:
        assert child.stdin is not None
        child.stdin.close()
        child.wait(timeout=10)
