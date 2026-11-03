"""Client requests: masked, journalled apart from responses, never routed.

Covers the live path (bytes through CaptureSession), the file path
(_ingest_capture over a pcapng) and the masking rules themselves.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from dw_collector.capture.session import CaptureSession
from dw_collector.ingest import _ingest_capture
from dw_collector.request_log import mask_request, request_observation
from dw_collector.storage.journal import Journal
from tests.test_capture_session import COLLECTOR, NOW, envelope, segment
from tests.test_protocol import _pcapng, _tcp_packet, frame

UID = "100058012345"
SIGNATURE = "c0ffee-session-signature"


def outbound(payload: bytes, *, seq: int = 1):  # type: ignore[no-untyped-def]
    return segment(payload, sport=50000, dport=8680, seq=seq)


def stored(journal: Journal) -> list[tuple[str, dict[str, object]]]:
    rows = journal.conn.execute(
        "select source_command, payload_json from request_observations order by rowid"
    ).fetchall()
    return [(r[0], json.loads(r[1])) for r in rows]


# --- masking -----------------------------------------------------------------


def test_identity_and_credentials_are_masked_but_the_pairing_id_survives() -> None:
    masked = mask_request(
        "get.new.user.info",
        {"_id": 41, "uid": UID, "targetUid": UID, "sign": SIGNATURE, "serverId": 580},
    )
    assert masked == {
        "_id": 41,
        "uid": "<masked:str>",
        "targetUid": "<masked:str>",
        "sign": "<masked:str>",
        "serverId": 580,
    }
    assert UID not in json.dumps(masked)


def test_masking_reaches_nested_values_and_bytes_and_does_not_mutate() -> None:
    payload = {"_id": 1, "list": [{"token": SIGNATURE, "x": 3}], "blob": b"\x01\x02\x03"}
    masked = mask_request("world.get.new", payload)
    assert masked["list"] == [{"token": "<masked:str>", "x": 3}]
    assert masked["blob"] == "<bytes:3>"
    assert payload["blob"] == b"\x01\x02\x03"
    assert mask_request("world.get.new", payload) == masked


def test_a_login_keeps_only_its_version_fields_in_clear() -> None:
    masked = mask_request(
        "account.login.new",
        {"_id": 2, "appVersion": "1.9.4", "name": "someone", "pwd": "x", "n": 7, "z": None},
    )
    assert masked == {
        "_id": 2,
        "appVersion": "1.9.4",
        "name": "<masked:str>",
        "pwd": "<masked:str>",
        "n": "<masked:int>",
        "z": None,
    }


# --- live path ---------------------------------------------------------------


def test_an_outbound_frame_is_journalled_masked_and_not_routed(
    journal: Journal,
) -> None:
    session = CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)
    request = envelope("world.get.new", {"_id": 9, "uid": UID, "sign": SIGNATURE, "viewLvl": 1})
    session.feed(outbound(frame(request)), now=NOW)

    assert stored(journal) == [
        (
            "world.get.new",
            {"_id": 9, "uid": "<masked:str>", "sign": "<masked:str>", "viewLvl": 1},
        )
    ]
    assert session.stats.requests == 1
    assert session.stats.ingested == 0
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 0
    assert journal.conn.execute("select count(*) from normalized_rows").fetchone()[0] == 0
    # Only the request's SHAPE is queued for the cloud, never a value.
    queued = journal.conn.execute("select event_type, payload_json from sync_outbox").fetchall()
    assert [q[0] for q in queued] == ["snapshot.command_request_shapes"]
    assert UID not in queued[0][1]
    assert SIGNATURE not in queued[0][1]
    assert '"viewLvl":"integer"' in queued[0][1].replace(" ", "")
    dump = " ".join(str(r) for r in journal.conn.iterdump())
    assert UID not in dump
    assert SIGNATURE not in dump


def test_a_response_still_takes_the_old_path(journal: Journal) -> None:
    session = CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)
    session.feed(segment(frame(envelope("push.unknown", {"_id": 1}))), now=NOW)
    assert session.stats.discovered == 1
    assert session.stats.requests == 0


@pytest.mark.parametrize(
    "obj",
    [
        {"a": 13, "c": 1},  # no extension envelope
        {"a": 13, "c": 1, "p": {"c": 5, "p": {}}},  # command is not a string
        {"a": 13, "c": 1, "p": {"c": "x.y", "p": "nope"}},  # payload is not an object
        {"a": 13, "c": 1, "p": {"c": "x.y"}},  # null/optional payload
    ],
)
def test_malformed_or_empty_requests_never_raise(journal: Journal, obj: dict[str, object]) -> None:
    session = CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)
    session.feed(outbound(frame(obj)), now=NOW)
    assert session.stats.rejected == 0
    # Only the payload-less but well-formed one is a request; the rest are not.
    assert session.stats.requests == (1 if obj.get("p") == {"c": "x.y"} else 0)


def test_garbage_bytes_from_the_client_do_not_stop_the_session(journal: Journal) -> None:
    session = CaptureSession(journal, collector_id=COLLECTOR, collected_from_server_id=580)
    session.feed(segment(b"\xff\xfe\x00garbage", sport=50001, dport=8680), now=NOW)
    session.feed(outbound(frame(envelope("a.b", {"_id": 1}))), now=NOW)
    assert session.stats.requests == 1


def test_record_request_is_idempotent_and_refuses_responses(journal: Journal) -> None:
    observation = request_observation(
        observation_id=uuid.uuid4(),
        collector_id=COLLECTOR,
        command="a.b",
        payload={"_id": 3},
        captured_at=NOW,
        collected_from_server_id=580,
    )
    assert journal.record_request(observation) is True
    assert journal.record_request(observation) is False
    assert len(stored(journal)) == 1

    inbound = observation.model_copy(update={"direction": "inbound"})
    with pytest.raises(ValueError, match="outbound"):
        journal.record_request(inbound)


# --- file path ---------------------------------------------------------------


def test_scan_of_a_capture_stores_requests_beside_responses(
    tmp_path: Path, journal: Journal
) -> None:
    packets = [
        _tcp_packet(
            frame(envelope("world.get.new", {"_id": 5, "uid": UID})),
            sport=50000,
            dport=8680,
            seq=1,
        ),
        _tcp_packet(
            frame(envelope("world.get.new", {"_id": 5, "p": 1})), sport=8680, dport=50000, seq=1
        ),
    ]
    pcap = tmp_path / "cap.pcapng"
    pcap.write_bytes(_pcapng(packets))

    def run():  # type: ignore[no-untyped-def]
        return _ingest_capture(
            journal,
            pcap,
            collector_id=COLLECTOR,
            collected_from_server=580,
            port=8680,
            discover_only=False,
            fallback=datetime(2026, 7, 1, tzinfo=UTC),
        )

    first = run()
    assert (first.requests, first.events) == (1, 1)
    run()  # replay: same observation ids, nothing doubles
    assert len(stored(journal)) == 1
    assert journal.conn.execute("select count(*) from raw_observations").fetchone()[0] == 1
    assert UID not in json.dumps(stored(journal))


def test_a_request_shape_is_queued_once_however_often_it_repeats(journal: Journal) -> None:
    def send(n: int, payload: dict[str, object]) -> None:
        journal.record_request(
            request_observation(
                observation_id=uuid.uuid5(uuid.NAMESPACE_URL, f"shape:{n}"),
                collector_id=COLLECTOR,
                command="world.get.new",
                payload=payload,
                captured_at=NOW,
                collected_from_server_id=580,
            )
        )

    def queued() -> int:
        return journal.conn.execute("select count(*) from sync_outbox").fetchone()[0]

    send(1, {"_id": 1, "x": 5})
    send(2, {"_id": 2, "x": 9})  # same shape, different values
    assert queued() == 1
    send(3, {"_id": 3, "x": 5, "y": 6})  # new shape
    assert queued() == 2
    assert len(stored(journal)) == 3
