"""Each game server listens on its own port, 8100 + server id, and the reader
takes every game port, not just 580's.

One Windows machine runs several BlueStacks instances, each account on its
own server. Found 2026-11-24: of three instances, wonderingduck (580) spoke
to port 8680, Pagoda (579) to 8679 and wonderedoffduck (629) to 8729. The
capture filter and the reader were both fixed on 8680, so two of the three
never reached the journal, and nothing said so — their files ingested 0 like
any quiet minute. `account.login.new`'s `accountArr[].port` is where the rule
comes from: 580 → 8680, 615 → 8715.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from typer.testing import CliRunner

from dw_collector.cli import app
from dw_collector.protocol.pcapng import (
    GAME_PORTS,
    game_port,
    iter_extension_events,
    server_of_port,
)
from dw_collector.protocol.sfs import SfsValue
from dw_collector.storage.journal import Journal
from tests.test_protocol import ENVELOPE, _pcapng, _tcp_packet, frame

runner = CliRunner()

# A ranking the al.rank parser accepts; a payload it rejects is counted, not
# journalled, and the end-to-end test below reads the journal.
RANK: dict[str, SfsValue] = ENVELOPE["p"]["p"]  # type: ignore[index, assignment]


def _envelope(command: str, payload: dict[str, SfsValue]) -> dict[str, SfsValue]:
    return {"a": 13, "c": 1, "p": {"c": command, "p": payload}}


def _login(server: int) -> dict[str, SfsValue]:
    return {"user": {"uid": str(server), "serverId": server}}


def _response(command: str, payload: dict[str, SfsValue], *, sport: int, dport: int, seq: int = 1):
    """One inbound frame from a server port to a client port; returns
    (packet, next sequence number) so a second frame can follow it."""
    wire = frame(_envelope(command, payload))
    return _tcp_packet(wire, sport=sport, dport=dport, seq=seq), seq + len(wire)


def test_a_game_port_is_8100_plus_the_server_id() -> None:
    assert game_port(580) == 8680
    assert game_port(579) == 8679
    assert server_of_port(8729) == 629
    assert server_of_port(8715) == 615
    # The three instances seen on 2026-11-24, and the group's edges.
    for port in (8679, 8680, 8729, game_port(565), game_port(588)):
        assert port in GAME_PORTS
    # Local tooling's favourite ports are not game ports.
    for port in (8080, 8443, 9000):
        assert port not in GAME_PORTS


def test_the_reader_takes_every_game_port_by_default(tmp_path: Path) -> None:
    on_579, _ = _response("al.rank", {"_id": 1}, sport=8679, dport=50001)
    on_629, _ = _response("al.rank", {"_id": 2}, sport=8729, dport=50002)
    not_a_game, _ = _response("al.rank", {"_id": 3}, sport=9000, dport=50003)
    capture = tmp_path / "three.pcapng"
    capture.write_bytes(_pcapng([on_579, on_629, not_a_game]))

    events = list(iter_extension_events(capture))

    # Both game ports decode, each on its own connection (client side first),
    # and the connection carries the server port the account really used.
    assert [(e.direction, e.connection) for e in events] == [
        ("inbound", ("10.0.0.2", 50001, "10.0.0.1", 8679)),
        ("inbound", ("10.0.0.2", 50002, "10.0.0.1", 8729)),
    ]


def test_a_request_to_any_game_port_is_outbound(tmp_path: Path) -> None:
    wire = frame(_envelope("al.rank", {"_id": 1}))
    request = _tcp_packet(wire, sport=50001, dport=8729, seq=1)
    capture = tmp_path / "request.pcapng"
    capture.write_bytes(_pcapng([request]))

    events = list(iter_extension_events(capture))

    assert [(e.direction, e.connection) for e in events] == [
        ("outbound", ("10.0.0.1", 50001, "10.0.0.2", 8729)),
    ]


def test_one_explicit_port_still_narrows_the_reader(tmp_path: Path) -> None:
    on_580, _ = _response("al.rank", {"_id": 1}, sport=8680, dport=50001)
    on_579, _ = _response("al.rank", {"_id": 2}, sport=8679, dport=50002)
    capture = tmp_path / "two.pcapng"
    capture.write_bytes(_pcapng([on_580, on_579]))

    events = list(iter_extension_events(capture, port=8680))

    assert [e.connection for e in events] == [("10.0.0.2", 50001, "10.0.0.1", 8680)]


def test_ingest_dir_labels_each_instance_with_the_server_its_port_and_login_name(
    tmp_path: Path,
) -> None:
    """End to end: two instances in one file, on two servers' ports, each
    logging in and then receiving a ranking. With `--follow-login-server`
    every row is labelled with its own account's server; nothing is 580."""
    directory = tmp_path / "captures"
    directory.mkdir()
    login_579, seq = _response("init", _login(579), sport=8679, dport=50001)
    rank_579, _ = _response("al.rank", RANK, sport=8679, dport=50001, seq=seq)
    login_629, seq = _response("init", _login(629), sport=8729, dport=50002)
    rank_629, _ = _response("al.rank", RANK, sport=8729, dport=50002, seq=seq)
    capture = directory / "cap_00001.pcapng"
    capture.write_bytes(_pcapng([login_579, login_629, rank_579, rank_629]))
    when = time.time() - 600
    os.utime(capture, (when, when))
    db = tmp_path / "journal.db"

    result = runner.invoke(
        app,
        [
            "ingest-dir",
            "--dir",
            str(directory),
            "--db",
            str(db),
            "--min-age-seconds",
            "0",
            "--follow-login-server",
        ],
    )

    assert result.exit_code == 0, result.output
    journal = Journal(db)
    labels = journal.conn.execute(
        "select collected_from_server_id, count(1) from raw_observations"
        " where source_command = 'al.rank' group by 1 order by 1"
    ).fetchall()
    journal.close()
    assert labels == [(579, 1), (629, 1)]
