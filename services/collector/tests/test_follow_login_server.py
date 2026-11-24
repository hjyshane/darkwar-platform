"""An account's captures are labelled with the server its own `init` named,
and the label is kept per TCP connection — so two accounts whose traffic
shares one capture file (BlueStacks instances on one machine) each get their
own, and a sub-account that moves servers follows without an edit to `.env`."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dw_collector import ingest
from dw_collector.ingest import ServerFollower, _ingest_capture

# Two BlueStacks instances: the same server address, a client port each.
CONN_A = ("10.0.0.1", 50001, "203.0.113.9", 8680)
CONN_B = ("10.0.0.1", 50002, "203.0.113.9", 8680)


class _Journal:
    def __init__(self) -> None:
        self.responses: list[tuple[str, int]] = []
        self.requests: list[int] = []

    def record(self, observation: Any, rows: Any) -> None:
        self.responses.append((observation.source_command, observation.collected_from_server_id))

    def record_request(self, request: Any) -> bool:
        self.requests.append(request.collected_from_server_id)
        return True


def _event(
    command: str,
    payload: dict[str, Any],
    direction: str = "inbound",
    connection: tuple[str, int, str, int] | None = CONN_A,
) -> SimpleNamespace:
    return SimpleNamespace(
        command=command,
        payload=payload,
        direction=direction,
        captured_at=None,
        connection=connection,
    )


def _login(server: int, connection: tuple[str, int, str, int] = CONN_A) -> SimpleNamespace:
    return _event("init", {"user": {"uid": "1", "serverId": server}}, connection=connection)


def _run(
    monkeypatch: pytest.MonkeyPatch,
    journal: _Journal,
    events: list[SimpleNamespace],
    *,
    follower: ServerFollower | None,
    name: str = "a.pcapng",
) -> None:
    def fake(_pcap: Path, *, port: int, streams: object = None) -> Iterator[SimpleNamespace]:
        return iter(events)

    monkeypatch.setattr(ingest, "iter_extension_events", fake)
    monkeypatch.setattr(ingest.pipeline, "observe", lambda _obs: [])
    _ingest_capture(
        journal,  # type: ignore[arg-type]
        Path(name),
        collector_id=uuid.uuid4(),
        collected_from_server=580,
        port=8680,
        discover_only=False,
        fallback=datetime.now(tz=UTC),
        follower=follower,
    )


def test_labels_follow_the_login_and_carry_into_the_next_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal = _Journal()
    follower = ServerFollower(580)
    _run(
        monkeypatch,
        journal,
        [_event("x.before", {}, "outbound"), _login(579), _event("get.al.info", {})],
        follower=follower,
    )
    _run(monkeypatch, journal, [_event("get.world.map", {})], follower=follower, name="b.pcapng")

    assert journal.requests == [580]  # sent before the login: still the start value
    assert journal.responses == [("init", 579), ("get.al.info", 579), ("get.world.map", 579)]


def test_two_accounts_in_one_file_each_keep_their_own_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Windows capture is machine-wide: every BlueStacks instance's traffic
    lands in the same file, interleaved. Each connection's label comes from
    ITS login, not from whichever account logged in last."""
    journal = _Journal()
    follower = ServerFollower(580)
    events = [
        _login(579, CONN_A),
        _login(581, CONN_B),
        _event("get.al.info", {}, connection=CONN_A),
        _event("al.rank", {}, connection=CONN_B),
        _event("world.get.new", {}, "outbound", connection=CONN_A),
        _event("world.get.new", {}, "outbound", connection=CONN_B),
        _event("push.world.march.new", {}, connection=CONN_A),
    ]

    _run(monkeypatch, journal, events, follower=follower)

    assert journal.responses == [
        ("init", 579),
        ("init", 581),
        ("get.al.info", 579),
        ("al.rank", 581),
        ("push.world.march.new", 579),
    ]
    assert journal.requests == [579, 581]


def test_a_connection_with_no_login_yet_gets_the_start_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After an ingest restart the account's login is in a file already read;
    its connection is unknown until the client reconnects. The configured
    server is the fallback, as before, and only for that connection."""
    journal = _Journal()
    follower = ServerFollower(580)
    events = [
        _login(579, CONN_A),
        _event("get.al.info", {}, connection=CONN_B),
        _event("get.al.info", {}, connection=CONN_A),
    ]

    _run(monkeypatch, journal, events, follower=follower)

    assert journal.responses == [("init", 579), ("get.al.info", 580), ("get.al.info", 579)]


def test_a_reconnect_on_a_new_port_relabels_from_its_own_login(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    journal = _Journal()
    follower = ServerFollower(580)
    moved = ("10.0.0.1", 50003, "203.0.113.9", 8680)

    _run(monkeypatch, journal, [_login(579, CONN_A)], follower=follower)
    _run(
        monkeypatch,
        journal,
        [_login(582, moved), _event("get.al.info", {}, connection=moved)],
        follower=follower,
        name="b.pcapng",
    )

    assert journal.responses == [("init", 579), ("init", 582), ("get.al.info", 582)]


def test_events_without_a_connection_share_one_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fixtures and the live reassembler hand over events with no connection;
    they behave as one chain, which is what the iPhone relied on."""
    journal = _Journal()
    follower = ServerFollower(580)

    _run(
        monkeypatch,
        journal,
        [_login(579, None), _event("get.al.info", {}, connection=None)],
        follower=follower,
    )

    assert journal.responses == [("init", 579), ("get.al.info", 579)]


def test_without_following_the_constant_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    journal = _Journal()

    _run(
        monkeypatch,
        journal,
        [_login(579, CONN_A), _login(581, CONN_B), _event("get.al.info", {}, connection=CONN_B)],
        follower=None,
    )

    assert journal.responses == [("init", 580), ("init", 580), ("get.al.info", 580)]


@pytest.mark.parametrize(
    "payload",
    [{}, {"user": None}, {"user": {}}, {"user": {"serverId": "579"}}, {"user": {"serverId": 0}}],
)
def test_a_login_with_no_usable_server_changes_nothing(payload: dict[str, Any]) -> None:
    follower = ServerFollower(580)

    follower.observe(CONN_A, "init", payload)

    assert follower.server_for(CONN_A) == 580


def test_only_init_moves_the_label() -> None:
    follower = ServerFollower(580)

    follower.observe(CONN_A, "get.al.info", {"user": {"serverId": 579}})

    assert follower.server_for(CONN_A) == 580
