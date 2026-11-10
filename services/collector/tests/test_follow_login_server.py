"""The phone's account moves servers; its captures must follow without an
edit to `.env`. `init` names the account's server, and everything after it in
the chain is labelled with that one."""

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


class _Journal:
    def __init__(self) -> None:
        self.responses: list[tuple[str, int]] = []
        self.requests: list[int] = []

    def record(self, observation: Any, rows: Any) -> None:
        self.responses.append((observation.source_command, observation.collected_from_server_id))

    def record_request(self, request: Any) -> bool:
        self.requests.append(request.collected_from_server_id)
        return True


def _event(command: str, payload: dict[str, Any], direction: str = "inbound") -> SimpleNamespace:
    return SimpleNamespace(command=command, payload=payload, direction=direction, captured_at=None)


def _run(
    monkeypatch: pytest.MonkeyPatch,
    journal: _Journal,
    events: list[SimpleNamespace],
    *,
    follower: ServerFollower | None,
    name: str = "a.pcapng",
) -> None:
    def fake(_pcap: Path, *, port: int) -> Iterator[SimpleNamespace]:
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
    login = _event("init", {"user": {"uid": "1", "serverId": 579}})
    _run(
        monkeypatch,
        journal,
        [_event("x.before", {}, "outbound"), login, _event("get.al.info", {})],
        follower=follower,
    )
    _run(monkeypatch, journal, [_event("get.world.map", {})], follower=follower, name="b.pcapng")

    assert journal.requests == [580]  # sent before the login: still the start value
    assert journal.responses == [("init", 579), ("get.al.info", 579), ("get.world.map", 579)]


def test_without_following_the_constant_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    journal = _Journal()
    login = _event("init", {"user": {"uid": "1", "serverId": 579}})

    _run(monkeypatch, journal, [login, _event("get.al.info", {})], follower=None)

    assert journal.responses == [("init", 580), ("get.al.info", 580)]


@pytest.mark.parametrize(
    "payload",
    [{}, {"user": None}, {"user": {}}, {"user": {"serverId": "579"}}, {"user": {"serverId": 0}}],
)
def test_a_login_with_no_usable_server_changes_nothing(payload: dict[str, Any]) -> None:
    follower = ServerFollower(580)

    follower.observe("init", payload)

    assert follower.current == 580


def test_only_init_moves_the_label() -> None:
    follower = ServerFollower(580)

    follower.observe("get.al.info", {"user": {"serverId": 579}})

    assert follower.current == 580
