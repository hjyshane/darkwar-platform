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

from dw_collector.desktop import capture, sidecar
from dw_collector.storage.journal import Journal
from tests.test_protocol import ENVELOPE, _pcapng, _tcp_packet, frame

_WINDOWS_ONLY = pytest.mark.skipif(
    sys.platform != "win32",
    reason="spawns a real process and confirms it is gone via taskkill/tasklist",
)


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


def _post(url: str, path: str) -> tuple[int, dict[str, object]]:
    """POST to `{url}{path}` with no body and return `(status, body)` even on
    a 4xx, same reasoning as `_put_settings`."""
    request = urllib.request.Request(f"{url}{path}", method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _get(url: str, path: str) -> tuple[int, dict[str, object]]:
    try:
        with urllib.request.urlopen(f"{url}{path}", timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _pid_alive(pid: int) -> bool:
    """Whether `pid` still exists, via `tasklist` — the same check
    `test_desktop_capture.py` uses for the same reason: no `psutil`
    dependency, and this proves a REAL kill, not a mocked one."""
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return str(pid) in result.stdout


#: A stub `dumpcap` argv: sleeps long enough to observe "running" and "a
#: stop/EOF actually ends it" without racing the test. Mirrors
#: `test_desktop_capture.py`'s own `_SLEEP_SCRIPT`/`_stub_argv` — this file
#: needs its own copy rather than importing theirs, since the whole point is
#: proving the SIDECAR's wiring, not reaching into another test module's
#: private helpers.
_SLEEP_SCRIPT = "import time; time.sleep(30)"


def _stub_capture_argv(
    dumpcap: str, interface: str, capture_dir: Path, game_port: int
) -> list[str]:
    return [dumpcap, "-c", _SLEEP_SCRIPT]


def _capture_supervisor_factory(dumpcap_path: str, journal_path: Path) -> capture.Supervisor:
    """Ignores the resolved `dumpcap_path` and points the supervisor at
    `sys.executable` running a sleep script instead — proves real
    spawn/status/stop behaviour through the sidecar without Npcap or a real
    `dumpcap.exe` anywhere near the test.

    `journal_path` is passed straight through to `Supervisor`, the same way
    `_default_supervisor_factory` in production does — this is the signature
    `_Server.supervisor_factory` requires post-wiring, and passing it through
    (rather than dropping it) is what lets the ingest loop actually run for
    every test that uses this fixture, not just the ones added for this gap.
    """
    return capture.Supervisor(
        dumpcap=sys.executable, build_argv=_stub_capture_argv, journal_path=journal_path
    )


@pytest.fixture
def capture_sidecar(tmp_path: Path) -> Iterator[_SidecarWithSettings]:
    """A sidecar wired for `/capture/*`, with `find_dumpcap` forced to
    `None` so "no dumpcap found" is deterministic regardless of whether the
    machine running the suite actually has Wireshark installed — production
    code never controls that, so a test relying on it not being there would
    be testing the test machine, not the sidecar.
    """
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    settings_path = tmp_path / "settings.json"
    httpd = sidecar.serve(
        journal_path,
        settings_path,
        port=0,
        find_dumpcap=lambda: None,
        supervisor_factory=_capture_supervisor_factory,
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield _SidecarWithSettings(
            url=f"http://127.0.0.1:{httpd.server_address[1]}", settings_path=settings_path
        )
    finally:
        if httpd.supervisor is not None:
            httpd.supervisor.stop()
        httpd.shutdown()
        httpd.server_close()


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


def _write_player_row(
    journal_path: Path,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    source_command: str = "kill.rank",
    server_id: int = 581,
    name: str | None = "ERHA",
    alliance_external_id: str | None = None,
    hq_level: int | None = None,
    power: int | None = None,
    kills: int | None = None,
    rank: int | None = None,
) -> None:
    """One `player_snapshots` sighting, as one command's normalizer would
    have left it — same row shape `test_desktop_localread.py`'s own
    `_write_player_row` fixture uses, so this endpoint is exercised against
    the same ground truth the projection's own tests are."""
    journal = Journal(journal_path)
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            source_command,
            captured_at,
            580,
            "{}",
            captured_at,
        ),
    )
    row = {
        "row": {
            "game_uid": game_uid,
            "server_id": server_id,
            "name": name,
            "alliance_external_id": alliance_external_id,
            "hq_level": hq_level,
            "power": power,
            "kills": kills,
            "rank": rank,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            "player_snapshots",
            f"{observation_id}-{game_uid}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()
    journal.close()


def _write_player_detail_row(
    journal_path: Path,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    server_id: int = 581,
    power_total: int | None = 100,
    power_components: dict[str, int] | None = None,
    components_sum_matches: bool | None = True,
) -> None:
    """One `player_detail_snapshots` row, as `get.new.user.info` would have
    left it — same shape as `test_desktop_localread.py`'s own fixture."""
    journal = Journal(journal_path)
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            "get.new.user.info",
            captured_at,
            580,
            "{}",
            captured_at,
        ),
    )
    row = {
        "row": {
            "game_uid": game_uid,
            "server_id": server_id,
            "power_total": power_total,
            "power_components": power_components if power_components is not None else {},
            "components_sum_matches": components_sum_matches,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            "player_detail_snapshots",
            f"{observation_id}-detail-{game_uid}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()
    journal.close()


def test_players_returns_an_empty_list_for_an_empty_journal(base: str) -> None:
    with urllib.request.urlopen(f"{base}/players?q=erha") as response:
        body = json.loads(response.read())
    assert body["matches"] == []


def test_players_an_empty_needle_is_refused(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/players?q=%20")
    assert raised.value.code == 400


def test_players_on_a_missing_journal_answers_rather_than_dropping(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "not-here.db"
    httpd = sidecar.serve(missing, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/players?q=erha"
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


def test_a_player_uid_crosses_as_a_string_so_it_cannot_round() -> None:
    """Same reasoning as `test_a_uid_crosses_as_a_string_so_it_cannot_round`
    for tiles: sixteen digits, one order of magnitude from
    `Number.MAX_SAFE_INTEGER`."""
    from dw_collector.desktop.localread import PlayerProfile

    profile = PlayerProfile(
        game_uid=1190060554000581,
        server_id=581,
        name="ERHA",
        alliance_external_id=None,
        hq_level=34,
        power=1_000_000,
        kills=500,
        rank=3,
        captured_at="2026-09-01T10:00:00+00:00",
    )
    body = sidecar.player_json(profile)
    assert body["gameUid"] == "1190060554000581"
    assert json.loads(json.dumps(body))["gameUid"] == "1190060554000581"


def test_a_real_player_profile_comes_back_merged_through_players_endpoint(
    tmp_path: Path,
) -> None:
    """End to end: two commands' sightings, merged into one profile, out
    through JSON — proving the per-field merge rule survives the wire."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    _write_player_row(
        journal_path,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        source_command="kill.rank",
        kills=500,
        rank=3,
    )
    _write_player_row(
        journal_path,
        observation_id="obs-2",
        captured_at="2026-09-01T11:00:00+00:00",
        game_uid=1190060554000581,
        source_command="server.rank",
        hq_level=34,
        power=1_000_000,
    )

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/players?q=erha"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert len(body["matches"]) == 1
    hit = body["matches"][0]
    assert hit["gameUid"] == "1190060554000581"
    # The merge rule: newest non-null value per field, independently — the
    # kills/rank from obs-1 survive even though obs-2 (the newer row) never
    # reports them, and captured_at is the newest sighting of EITHER kind.
    assert hit["kills"] == 500
    assert hit["rank"] == 3
    assert hit["hqLevel"] == 34
    assert hit["power"] == 1_000_000
    assert hit["capturedAt"] == "2026-09-01T11:00:00+00:00"


def test_player_detail_endpoint_returns_profile_and_detail(tmp_path: Path) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    _write_player_row(
        journal_path,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        source_command="kill.rank",
        kills=500,
        rank=3,
    )
    _write_player_detail_row(
        journal_path,
        observation_id="obs-2",
        captured_at="2026-09-01T11:00:00+00:00",
        game_uid=1190060554000581,
        power_total=100,
        power_components={"armyPower": 40, "buildingPower": 60},
        components_sum_matches=True,
    )

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/player/1190060554000581"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert body["profile"]["gameUid"] == "1190060554000581"
    assert body["profile"]["kills"] == 500
    assert body["detail"] is not None
    assert body["detail"]["powerTotal"] == 100
    assert body["detail"]["powerComponents"] == {"armyPower": 40, "buildingPower": 60}
    assert body["detail"]["componentsSumMatches"] is True


def test_player_detail_endpoint_reports_a_mismatched_sum_rather_than_hiding_it(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    _write_player_row(
        journal_path,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
    )
    _write_player_detail_row(
        journal_path,
        observation_id="obs-2",
        captured_at="2026-09-01T11:00:00+00:00",
        game_uid=1190060554000581,
        power_total=100,
        power_components={"armyPower": 40},
        components_sum_matches=False,
    )

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/player/1190060554000581"
        with urllib.request.urlopen(url) as response:
            body = json.loads(response.read())
    finally:
        httpd.shutdown()
        httpd.server_close()

    assert body["detail"]["componentsSumMatches"] is False


def test_player_detail_endpoint_is_a_404_for_an_unseen_uid(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/player/1190060554000581")
    assert raised.value.code == 404


def test_player_detail_endpoint_is_a_400_for_a_non_numeric_uid(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/player/not-a-uid")
    assert raised.value.code == 400


def test_player_detail_endpoint_on_a_missing_journal_answers_rather_than_dropping(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "not-here.db"
    httpd = sidecar.serve(missing, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/player/1190060554000581"
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


def test_capture_status_json_shape() -> None:
    """Pure function, no server — same idiom as `tile_json`'s own test."""
    status = capture.CaptureStatus(
        state="failed",
        pid=123,
        returncode=1,
        stderr="boom",
        ingest=capture.IngestStatus(
            state="died", files_seen=2, files_ingested=1, rows_written=5, error="RuntimeError: x"
        ),
    )
    body = sidecar.capture_status_json(status, files=3, rows=42)
    assert body == {
        "capture": {"state": "failed", "pid": 123, "returncode": 1, "stderr": "boom"},
        "ingest": {
            "state": "died",
            "filesSeen": 2,
            "filesIngested": 1,
            "rowsWritten": 5,
            "error": "RuntimeError: x",
        },
        "files": 3,
        "rows": 42,
    }


def test_count_pcapng_files_counts_only_pcapng(tmp_path: Path) -> None:
    (tmp_path / "cap_1.pcapng").write_bytes(b"")
    (tmp_path / "cap_2.pcapng").write_bytes(b"")
    (tmp_path / "notes.txt").write_bytes(b"")
    assert sidecar._count_pcapng_files(str(tmp_path)) == 2


def test_count_pcapng_files_is_zero_for_unconfigured_or_missing_dir(tmp_path: Path) -> None:
    assert sidecar._count_pcapng_files("") == 0
    assert sidecar._count_pcapng_files(str(tmp_path / "does-not-exist")) == 0


def test_cheap_row_count_counts_raw_observations(tmp_path: Path) -> None:
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
    journal.conn.commit()
    journal.close()
    assert sidecar._cheap_row_count(journal_path) == 1


def test_cheap_row_count_is_zero_for_a_missing_journal(tmp_path: Path) -> None:
    assert sidecar._cheap_row_count(tmp_path / "not-here.db") == 0


def test_capture_status_before_anything_starts(capture_sidecar: _SidecarWithSettings) -> None:
    status, body = _get(capture_sidecar.url, "/capture/status")
    assert status == 200
    assert set(body) == {"capture", "ingest", "files", "rows"}
    assert set(body["capture"]) == {"state", "pid", "returncode", "stderr"}  # type: ignore[arg-type]
    assert set(body["ingest"]) == {  # type: ignore[arg-type]
        "state",
        "filesSeen",
        "filesIngested",
        "rowsWritten",
        "error",
    }
    assert body["capture"]["state"] == "stopped"  # type: ignore[index]
    assert body["files"] == 0
    assert body["rows"] == 0


def test_capture_stop_when_nothing_started_is_200_not_an_error(
    capture_sidecar: _SidecarWithSettings,
) -> None:
    """A player pressing Stop twice — or before ever pressing Start — has
    done nothing wrong."""
    status, body = _post(capture_sidecar.url, "/capture/stop")
    assert status == 200
    assert body["capture"]["state"] == "stopped"  # type: ignore[index]

    status, body = _post(capture_sidecar.url, "/capture/stop")
    assert status == 200
    assert body["capture"]["state"] == "stopped"  # type: ignore[index]


def test_capture_start_refuses_an_empty_interface(capture_sidecar: _SidecarWithSettings) -> None:
    """A fresh install's state: no adapter has been picked yet."""
    status, body = _post(capture_sidecar.url, "/capture/start")
    assert status == 400
    assert "interface" in str(body["error"]).lower()


def test_capture_start_refuses_when_dumpcap_cannot_be_found(
    capture_sidecar: _SidecarWithSettings,
) -> None:
    _put_settings(capture_sidecar.url, {"interface": r"\Device\NPF_test"})
    status, body = _post(capture_sidecar.url, "/capture/start")
    assert status == 400
    assert "dumpcap" in str(body["error"]).lower()


def test_capture_start_refuses_an_empty_capture_directory(
    capture_sidecar: _SidecarWithSettings,
) -> None:
    _put_settings(
        capture_sidecar.url,
        {"interface": r"\Device\NPF_test", "dumpcapPath": "stub-dumpcap.exe"},
    )
    status, body = _post(capture_sidecar.url, "/capture/start")
    assert status == 400
    assert "directory" in str(body["error"]).lower()


@_WINDOWS_ONLY
def test_capture_start_never_spawns_on_a_refused_configuration(
    capture_sidecar: _SidecarWithSettings,
) -> None:
    """None of the three refusals may leave a `Supervisor` behind, spawned
    or not — a bad configuration must never even create one."""
    status, _ = _post(capture_sidecar.url, "/capture/start")
    assert status == 400
    status, body = _get(capture_sidecar.url, "/capture/status")
    assert body["capture"]["state"] == "stopped"  # type: ignore[index]
    assert body["capture"]["pid"] is None  # type: ignore[index]


@_WINDOWS_ONLY
def test_capture_start_status_stop_round_trip(
    capture_sidecar: _SidecarWithSettings, tmp_path: Path
) -> None:
    _put_settings(
        capture_sidecar.url,
        {
            "interface": r"\Device\NPF_test",
            "captureDir": str(tmp_path / "captures"),
            "dumpcapPath": "stub-dumpcap.exe",
        },
    )

    status, start_body = _post(capture_sidecar.url, "/capture/start")
    assert status == 200
    assert start_body["capture"]["state"] == "running"  # type: ignore[index]
    pid = start_body["capture"]["pid"]  # type: ignore[index]
    assert pid is not None
    assert _pid_alive(pid)

    status, status_body = _get(capture_sidecar.url, "/capture/status")
    assert status == 200
    assert status_body["capture"]["state"] == "running"  # type: ignore[index]
    assert status_body["capture"]["pid"] == pid  # type: ignore[index]

    status, stop_body = _post(capture_sidecar.url, "/capture/stop")
    assert status == 200
    assert stop_body["capture"]["state"] == "stopped"  # type: ignore[index]

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and _pid_alive(pid):
        time.sleep(0.2)
    assert not _pid_alive(pid)

    # Pressing Stop again afterward is still 200, not an error.
    status, body = _post(capture_sidecar.url, "/capture/stop")
    assert status == 200
    assert body["capture"]["state"] == "stopped"  # type: ignore[index]


#: The lifetime-test child process: a minimal stand-in for `main()` that
#: takes a `supervisor_factory` the real entrypoint has no way to accept
#: from the command line. It calls the exact same private functions `main()`
#: does (`sidecar._stop_when_stdin_closes`, `sidecar._stop_capture`) so this
#: proves the real wiring, not a reimplementation of it.
_LIFETIME_TEST_SCRIPT = """
import sys, threading
from pathlib import Path
from dw_collector.desktop import sidecar, capture

def build_argv(dumpcap, interface, capture_dir, game_port):
    return [dumpcap, "-c", "import time; time.sleep(30)"]

def supervisor_factory(dumpcap, journal_path):
    return capture.Supervisor(
        dumpcap=sys.executable, build_argv=build_argv, journal_path=journal_path
    )

httpd = sidecar.serve(Path(sys.argv[1]), supervisor_factory=supervisor_factory, port=0)
print(f"PORT {httpd.server_address[1]}", flush=True)
threading.Thread(target=sidecar._stop_when_stdin_closes, args=(httpd,), daemon=True).start()
try:
    httpd.serve_forever()
finally:
    sidecar._stop_capture(httpd)
    httpd.server_close()
"""


@_WINDOWS_ONLY
def test_closing_stdin_stops_the_capture_supervisor_too(tmp_path: Path) -> None:
    """THE TEST THAT MATTERS MOST.

    The lifetime chain is window -> sidecar -> dumpcap. `test_closing_stdin_
    stops_the_process` above already proves the sidecar tears down its own
    HTTP server on stdin EOF — but before this task that guard never reached
    a `dumpcap` child the sidecar had since started. If Rust died badly
    while a capture was running, the sidecar would exit and `dumpcap` would
    be left running with nothing on screen and nothing reading its files —
    the same orphan `docs/runbooks/desktop-sidecar-lifecycle.md` already
    documents fixing once, one process further down.

    This starts a (stubbed) capture through the REAL `/capture/start`
    endpoint, closes the sidecar's stdin exactly the way a dead Rust parent
    would, and confirms the capture CHILD process — not just the sidecar
    itself — is actually gone afterward.
    """
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    child = subprocess.Popen(
        [sys.executable, "-c", _LIFETIME_TEST_SCRIPT, str(journal_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert child.stdout is not None
        announced = child.stdout.readline().strip()
        assert announced.startswith("PORT ")
        port = int(announced.removeprefix("PORT "))
        base = f"http://127.0.0.1:{port}"

        _put_settings(
            base,
            {
                "interface": r"\Device\NPF_test",
                "captureDir": str(tmp_path / "captures"),
                "dumpcapPath": "stub-dumpcap.exe",
            },
        )
        status, body = _post(base, "/capture/start")
        assert status == 200
        assert body["capture"]["state"] == "running"  # type: ignore[index]
        capture_pid = body["capture"]["pid"]  # type: ignore[index]
        assert capture_pid is not None
        assert _pid_alive(capture_pid), "the stub capture child never started"

        assert child.stdin is not None
        child.stdin.close()

        # Generous: process teardown on Windows is not instant, same
        # reasoning as `test_closing_stdin_stops_the_process`.
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.1)
        assert child.poll() is not None, "sidecar outlived its parent's stdin"

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and _pid_alive(capture_pid):
            time.sleep(0.2)
        assert not _pid_alive(capture_pid), (
            "the sidecar exited but left its dumpcap child running behind — "
            "exactly the orphan this task exists to close"
        )
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)


#: `Settings.game_port`'s default (8680) — matched here rather than
#: hardcoded independently, so a fixture packet's TCP source port always
#: agrees with what `_handle_capture_start` will actually filter for.
_END_TO_END_GAME_PORT = 8680


def _write_ready_capture(path: Path, *, age_seconds: float = 600.0) -> None:
    """A `.pcapng` fixture `_ready_captures` will treat as closed, holding
    one real decodable `al.rank` event — the same machinery
    `test_desktop_capture.py`'s own `_write_capture` and `test_protocol.py`
    use to prove pcapng decoding, reused here rather than inventing bytes.
    """
    packet = _tcp_packet(frame(ENVELOPE), sport=_END_TO_END_GAME_PORT, dport=50000, seq=1)
    path.write_bytes(_pcapng([packet]))
    when = time.time() - age_seconds
    os.utime(path, (when, when))


def _wait_for_rows(url: str, *, timeout: float = 10.0) -> dict[str, object]:
    """Poll `/capture/status` until `rows` leaves zero or `timeout` elapses.

    Bounded, per the task's "explicit timeout" requirement — a wedged ingest
    thread must fail this test loudly within `timeout` seconds, never hang
    the suite.
    """
    deadline = time.monotonic() + timeout
    body: dict[str, object] = {}
    while time.monotonic() < deadline:
        _, body = _get(url, "/capture/status")
        rows = body.get("rows")
        if isinstance(rows, int) and rows > 0:
            return body
        time.sleep(0.1)
    return body


@_WINDOWS_ONLY
def test_capture_start_ingests_a_ready_capture_end_to_end(
    capture_sidecar: _SidecarWithSettings, tmp_path: Path
) -> None:
    """THE TEST THAT MATTERS.

    Before this task, `Handler._get_or_create_supervisor` built the
    production `Supervisor` with no `journal_path` at all —
    `Supervisor.__init__`'s default — which is exactly what tells
    `Supervisor._start_ingest_loop` never to start the ingest thread. dumpcap
    ran, the ring rotated, `files` climbed, and NOT ONE ROW EVER REACHED THE
    JOURNAL: a player would watch this look healthy for hours and get
    nothing. This drives the whole path through the REAL
    `POST /capture/start` endpoint (not `Supervisor` directly, the way
    `test_desktop_capture.py`'s own end-to-end test does) with a ready
    `.pcapng` fixture already sitting in the capture directory, and proves
    `rows` actually leaves zero and `ingest.state` reaches `"running"`.

    See this task's mutation test (reverting `_get_or_create_supervisor`'s
    `journal_path` argument to `None`) for proof this test actually fails
    without the fix.
    """
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_ready_capture(capture_dir / "cap_00001.pcapng")

    _put_settings(
        capture_sidecar.url,
        {
            "interface": r"\Device\NPF_test",
            "captureDir": str(capture_dir),
            "dumpcapPath": "stub-dumpcap.exe",
            "gamePort": _END_TO_END_GAME_PORT,
        },
    )

    status, start_body = _post(capture_sidecar.url, "/capture/start")
    assert status == 200
    assert start_body["capture"]["state"] == "running"  # type: ignore[index]

    status_body = _wait_for_rows(capture_sidecar.url)
    rows = status_body.get("rows")
    assert isinstance(rows, int) and rows > 0, (
        "rows never left zero — the ingest thread never ran, exactly the "
        f"gap this task exists to close (last status: {status_body!r})"
    )
    assert status_body["ingest"]["state"] == "running"  # type: ignore[index]


@_WINDOWS_ONLY
def test_capture_start_creates_the_journal_when_it_does_not_exist_yet(
    tmp_path: Path,
) -> None:
    """A FRESH INSTALL HAS NO JOURNAL FILE YET.

    Starting capture before the journal exists must create it, not fail — a
    previous bug in exactly this spot made every first ingest fail with "no
    such table" (see `capture._default_journal_factory`'s `init_db()` call,
    which is what makes this work). This proves it end-to-end through the
    sidecar, rather than trusting the docstring: no `Journal(...).init_db()`
    is ever called by this test.
    """
    journal_path = tmp_path / "collector.db"
    assert not journal_path.exists()

    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_ready_capture(capture_dir / "cap_00001.pcapng")

    settings_path = tmp_path / "settings.json"
    httpd = sidecar.serve(
        journal_path,
        settings_path,
        port=0,
        find_dumpcap=lambda: None,
        supervisor_factory=_capture_supervisor_factory,
    )
    Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        _put_settings(
            url,
            {
                "interface": r"\Device\NPF_test",
                "captureDir": str(capture_dir),
                "dumpcapPath": "stub-dumpcap.exe",
                "gamePort": _END_TO_END_GAME_PORT,
            },
        )
        status, start_body = _post(url, "/capture/start")
        assert status == 200
        assert start_body["capture"]["state"] == "running"  # type: ignore[index]

        status_body = _wait_for_rows(url)
        rows = status_body.get("rows")
        assert isinstance(rows, int) and rows > 0, (
            f"rows never left zero on a fresh install (last status: {status_body!r})"
        )
        assert journal_path.exists()
    finally:
        if httpd.supervisor is not None:
            httpd.supervisor.stop()
        httpd.shutdown()
        httpd.server_close()


@_WINDOWS_ONLY
def test_put_settings_journal_path_change_does_not_affect_a_running_capture(
    capture_sidecar: _SidecarWithSettings, tmp_path: Path
) -> None:
    """DECISION: a `journalPath` moved by `PUT /settings` while a capture is
    running takes effect on the sidecar's NEXT launch, never on this one.

    See `_Server.journal_path`'s docstring for why (in short: `/health`,
    `/find`, and the capture `Supervisor` all read that one fixed attribute,
    never `Settings.journal_path` — so there is nothing here that COULD
    half-switch mid-capture). This proves it: move the path while rows are
    already landing, and confirm the new path is saved to disk but never
    created or written to by this process, while the original journal
    (the one `/health` still names) keeps being the one in use.
    """
    capture_dir = tmp_path / "captures"
    capture_dir.mkdir()
    _write_ready_capture(capture_dir / "cap_00001.pcapng")

    _put_settings(
        capture_sidecar.url,
        {
            "interface": r"\Device\NPF_test",
            "captureDir": str(capture_dir),
            "dumpcapPath": "stub-dumpcap.exe",
            "gamePort": _END_TO_END_GAME_PORT,
        },
    )
    status, start_body = _post(capture_sidecar.url, "/capture/start")
    assert status == 200
    assert start_body["capture"]["state"] == "running"  # type: ignore[index]

    status_body = _wait_for_rows(capture_sidecar.url)
    rows = status_body.get("rows")
    assert isinstance(rows, int) and rows > 0

    elsewhere = tmp_path / "elsewhere.db"
    put_status, put_body = _put_settings(capture_sidecar.url, {"journalPath": str(elsewhere)})
    assert put_status == 200
    assert put_body["journalPath"] == str(elsewhere)
    # It DID save to disk — a `PUT` is never silently dropped...
    on_disk = json.loads(capture_sidecar.settings_path.read_text(encoding="utf-8"))
    assert on_disk["journal_path"] == str(elsewhere)
    # ...but this running process must never create or touch that file.
    assert not elsewhere.exists()

    # `/health` still names the ORIGINAL journal — nothing in this process
    # ever re-pointed at the new path.
    health_status, health_body = _get(capture_sidecar.url, "/health")
    assert health_status == 200
    assert health_body["journal"] != str(elsewhere)
    assert health_body["ok"] is True


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
