"""user.get.arena.info normalizer against the REAL payload shape (S14-PR2).

top100_580v582_v1.json is extracted from darkwar_arena_match.pcapng by
`dw-collector extract-fixture` (sanitized; see protocol-fixtures/manifests).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from dw_collector.normalize import arena
from dw_collector.protocol.army import MAX_STAR
from tests.conftest import load_observation


def test_header_and_entries() -> None:
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    rows = arena.normalize(observation)

    header = rows[0]
    # Selected by table, not by slicing: the lineup rows share this list now.
    entries = [r for r in rows if r.target_table == "arena_entries"]
    assert header.target_table == "arena_snapshots"
    assert len(entries) == 100

    # The game's own startTime IS Monday 02:00 UTC — the third independent
    # confirmation of the reset rule.
    week_start = datetime.fromisoformat(header.row["week_start"])
    assert week_start == datetime(2026, 7, 27, 2, tzinfo=UTC)
    assert header.row["entry_count"] == 100
    assert header.row["server_id"] == 580
    # Header raw keeps the unpromoted fields but never the entry list.
    assert header.row["raw"]["fightServers"] == "580;582"
    assert "rankArr" not in header.row["raw"]

    parent_id = header.row["snapshot_id"]
    assert all(e.row["arena_snapshot_id"] == parent_id for e in entries)

    top = entries[0].row
    assert top["rank"] == 1
    assert top["game_uid"] == 9409201957000580
    assert top["score"] == 1213
    assert top["defense_power"] == 296837700
    assert top["server_id"] == 580
    # Cross-server matchup: entries carry their own subject server.
    assert {e.row["server_id"] for e in entries} == {580, 582}
    assert "alName" in top["raw"]
    # Promoted out of raw: the response names the opponent's alliance, so a
    # top-100 board can be read by who is in it rather than only by uid.
    assert top["alliance_name"] == "Alliance01"
    assert top["alliance_code"] == "A001"


def test_null_and_missing_optionals() -> None:
    observation = load_observation("user.get.arena.info/arena_nulls_v1.json")
    rows = arena.normalize(observation)

    header, entries = rows[0], rows[1:]
    assert len(entries) == 3
    # No startTime → week derived from capture time.
    assert datetime.fromisoformat(header.row["week_start"]) == datetime(2026, 7, 27, 2, tzinfo=UTC)
    bare = entries[0].row
    assert bare["score"] is None
    assert bare["defense_power"] is None
    # serverId missing → derived from the uid's embedded server suffix.
    assert bare["server_id"] == 582
    # An unallied player has no alliance, which must stay null rather than
    # becoming an empty tag that renders as a blank chip.
    assert bare["alliance_name"] is None
    assert bare["alliance_code"] is None


def test_malformed_payload_rejected() -> None:
    observation = load_observation("user.get.arena.info/arena_malformed_v1.json")
    with pytest.raises(ValidationError):
        arena.normalize(observation)


def test_replay_regenerates_identical_parent_pk() -> None:
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    first = arena.normalize(observation)[0].row["snapshot_id"]
    second = arena.normalize(observation)[0].row["snapshot_id"]
    assert first == second


def test_lineups_become_rows_under_their_entry() -> None:
    """Five heroes per entry, each pointing at the arena_entries row it was
    decoded from — the parent link has to survive replay, since the child's
    FK is the parent's deterministic snapshot_id."""
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    rows = arena.normalize(observation)

    entries = [r for r in rows if r.target_table == "arena_entries"]
    heroes = [r for r in rows if r.target_table == "arena_entry_heroes"]
    assert len(entries) == 100
    assert len(heroes) == 500

    by_entry: dict[str, list[dict]] = {}
    for hero in heroes:
        by_entry.setdefault(hero.row["arena_entry_id"], []).append(hero.row)
    assert set(by_entry) == {entry.row["snapshot_id"] for entry in entries}
    assert {len(group) for group in by_entry.values()} == {5}

    first = by_entry[entries[0].row["snapshot_id"]]
    assert sorted(h["slot"] for h in first) == [1, 2, 3, 4, 5]
    assert all(h["game_uid"] == entries[0].row["game_uid"] for h in first)
    assert all(h["server_id"] == entries[0].row["server_id"] for h in first)
    assert all(h["troop_class"] in (1, 2, 3) for h in first)


def test_stage_is_stored_below_the_cap_and_null_at_it() -> None:
    """0038. The decoder emitted `stage` from the start and the normalizer
    never read it, so it was discarded on every observation for thirteen
    migrations. What makes it worth a test rather than one more assignment is
    the null: proto3 sends nothing for a maxed hero and nothing decodes to 0,
    which is also a real value below the cap. Writing both as 0 would put
    "finished" and "not started" in the same column.
    """
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    heroes = [r.row for r in arena.normalize(observation) if r.target_table == "arena_entry_heroes"]

    maxed = [h for h in heroes if h["star"] == MAX_STAR]
    below = [h for h in heroes if h["star"] is not None and h["star"] < MAX_STAR]
    assert maxed and below, "the fixture has to contain both to prove anything"

    assert all(h["stage"] is None for h in maxed)
    # Not "every one of them is set" — below the cap 0 is legitimate, so the
    # claim is that the value survives, and that at least one is non-zero.
    assert all(isinstance(h["stage"], int) for h in below)
    assert any(h["stage"] > 0 for h in below)
    assert {h["stage"] for h in below} <= {0, 1, 2, 3, 4}


def test_stage_survives_a_star_the_decoder_did_not_read() -> None:
    """A unit with no star is not a maxed unit. Both write null, but for
    opposite reasons, and the one that matters is that an unknown star must
    not let a 0 through as though the cap had been checked."""
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    rows = arena.normalize(observation)
    heroes = [r.row for r in rows if r.target_table == "arena_entry_heroes"]

    for hero in heroes:
        if hero["star"] is None:
            assert hero["stage"] is None


def test_lineup_keys_are_stable_and_distinct() -> None:
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    first = [r.idempotency_key for r in arena.normalize(observation)]
    second = [r.idempotency_key for r in arena.normalize(observation)]

    assert first == second
    assert len(set(first)) == len(first)


def test_a_blank_lineup_yields_no_hero_rows() -> None:
    """Synthesized rather than taken from a fixture: every committed fixture
    now carries real lineups, and an entry with no `army` still has to produce
    its entry row instead of failing the whole batch."""
    observation = load_observation("user.get.arena.info/top100_580v582_v1.json")
    blanked = observation.model_copy(
        update={
            "payload": {
                **observation.payload,
                "rankArr": [{**e, "army": ""} for e in observation.payload["rankArr"]],
            }
        }
    )
    rows = arena.normalize(blanked)

    assert len([r for r in rows if r.target_table == "arena_entries"]) == 100
    assert [r for r in rows if r.target_table == "arena_entry_heroes"] == []


def test_league_distinguishes_the_two_boards() -> None:
    """Gold and Silver come back from the SAME command.

    Nothing else in the header separates them: `arenaType` and
    `selfArenaType` are 1 in both. Before 0062 they landed as two
    indistinguishable snapshots and the dashboard, taking the newest one,
    showed whichever was captured last — in the live database Silver, by 1.7
    seconds, with Gold's 163 players unread behind it.
    """
    gold = arena.normalize(load_observation("user.get.arena.info/top100_580v582_v1.json"))[0]
    silver = arena.normalize(load_observation("user.get.arena.info/top100_silver_580_v1.json"))[0]

    assert gold.row["league"] == 1
    assert silver.row["league"] == 2

    # The other two candidates agree in both, which is why neither is it.
    assert gold.row["raw"]["arenaType"] == silver.row["raw"]["arenaType"] == 1
    assert gold.row["raw"]["selfArenaType"] == silver.row["raw"]["selfArenaType"] == 1

    # The second, independent signal: Gold is the cross-server board.
    assert gold.row["raw"]["fightServers"] == "580;582"
    assert silver.row["raw"]["fightServers"] == "580"

    # And they must not collide, or one would overwrite the other on sync.
    assert gold.idempotency_key != silver.idempotency_key


def test_silver_entries_are_all_one_server() -> None:
    rows = arena.normalize(load_observation("user.get.arena.info/top100_silver_580_v1.json"))
    entries = [r for r in rows if r.target_table == "arena_entries"]
    assert len(entries) == 100
    assert {e.row["server_id"] for e in entries} == {580}


def test_league_is_null_when_the_payload_does_not_say() -> None:
    """FR-UI-008: unknown is unknown.

    proto3 omits defaults, so a missing userArenaType cannot be read as
    league 0 — and guessing 1 would file an unknown board under Gold.
    """
    header = arena.normalize(load_observation("user.get.arena.info/arena_nulls_v1.json"))[0]
    assert header.row["league"] is None
