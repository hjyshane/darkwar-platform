"""cross.server.rank: one server's top 150, from the Migration tab's state list.

The fixture is the first live capture (2026-10-27), server 584, cut to five.
"""

from __future__ import annotations

from dw_collector import registry
from dw_collector.normalize import cross_server_rank, server_rank
from tests.conftest import load_observation

FIXTURE = "cross.server.rank/server_584_top5_v1.json"


def test_registered() -> None:
    assert registry.get("cross.server.rank") is cross_server_rank.normalize


def test_every_entry_is_a_player_snapshot_of_its_own_server() -> None:
    rows = cross_server_rank.normalize(load_observation(FIXTURE))

    assert len(rows) == 5
    assert {r.target_table for r in rows} == {"player_snapshots"}
    assert {r.row["server_id"] for r in rows} == {584}
    assert rows[0].row["power"] > rows[1].row["power"]


def test_the_place_in_the_server_stays_in_raw_and_not_in_the_rank_column() -> None:
    rows = cross_server_rank.normalize(load_observation(FIXTURE))

    assert [r.row["raw"]["rank"] for r in rows] == [1, 2, 3, 4, 5]
    assert {r.row["rank"] for r in rows} == {None}


def test_keys_do_not_collide_with_the_group_board() -> None:
    observation = load_observation(FIXTURE)
    ours = cross_server_rank.normalize(observation)[0].idempotency_key
    board = server_rank.normalize(observation.model_copy(update={"source_command": "server.rank"}))[
        0
    ].idempotency_key

    assert ours != board
