"""Season sites on the map (0315): the floating lantern and what it reveals.

What this pins: a type-29 tile in any state becomes one season_site_snapshots
row carrying its cat id (which already names the content), its status and the
game's own instants; a tile missing what the rules need becomes nothing; and
overlapping viewports of the same unchanged site share one key while a change
of state does not. Payloads hand-authored from the tiles matched to in-game
share links on 2026-11-10, with invented people.
"""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime
from typing import Any

from dw_collector.models import Observation
from dw_collector.normalize import world_map
from dw_collector.protocol.worldmap import B64_PREFIX, SITE_OPEN, SITE_UNLIT

COLLECTOR = uuid.UUID("00000000-0000-0000-0000-000000000001")
CAPTURED = datetime(2026, 11, 10, 1, 10, 26, tzinfo=UTC)
EXPIRES_MS = 1794277500000
REVEALED_MS = 1794268874000
PLAYER_A = "1190060554000580"
PLAYER_B = "1264742586000580"


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _v(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _b(number: int, payload: bytes) -> bytes:
    return _varint((number << 3) | 2) + _varint(len(payload)) + payload


def site_point(
    *,
    x: int = 454,
    y: int = 276,
    cat_id: int = 1440,
    status: int = SITE_UNLIT,
    site_uuid: int = 1435887707426538645,
    participants: tuple[str, ...] = (),
    revealed: bool = False,
    with_expiry: bool = True,
    server: int | None = 580,
) -> str:
    inner = _v(1, site_uuid) + _v(2, cat_id)
    if with_expiry:
        inner += _v(3, EXPIRES_MS)
    if revealed:
        inner += _v(4, REVEALED_MS) + _v(5, 3600)
    if participants:
        inner += _b(7, ";".join(participants).encode())
    inner += _v(8, status)
    point = _v(1, y * 1000 + x + 1) + _v(2, 29) + _v(100, site_uuid) + _b(101, inner)
    if server is not None:
        point += _v(102, server) + _v(103, server)
    return B64_PREFIX + base64.b64encode(point).decode()


def viewport(*points: str) -> Observation:
    return Observation(
        observation_id=uuid.uuid4(),
        collector_id=COLLECTOR,
        source_command="world.get.new",
        captured_at=CAPTURED,
        collected_from_server_id=580,
        payload={"x": 450, "y": 270, "viewLvl": 0, "serverId": 580, "points": list(points)},
    )


def site_rows(observation: Observation) -> list[Any]:
    return [
        r for r in world_map.normalize(observation) if r.target_table == "season_site_snapshots"
    ]


def test_an_unlit_lantern_is_stored_with_the_content_it_hides() -> None:
    (row,) = site_rows(viewport(site_point()))

    assert row.row["site_uuid"] == "1435887707426538645"
    assert row.row["cat_id"] == 1440
    assert row.row["status"] == SITE_UNLIT
    assert (row.row["x"], row.row["y"], row.row["server_id"]) == (454, 276, 580)
    assert datetime.fromisoformat(row.row["expires_at"]).timestamp() * 1000 == EXPIRES_MS
    assert row.row["revealed_at"] is None
    assert row.row["limit_seconds"] is None
    assert row.row["participant_uids"] == []
    assert row.row["parser_version"] == world_map.PARSER_VERSION


def test_an_open_site_keeps_its_reveal_instant_and_its_people() -> None:
    (row,) = site_rows(
        viewport(
            site_point(
                x=457,
                y=262,
                cat_id=1530,
                status=SITE_OPEN,
                participants=(PLAYER_A, PLAYER_B),
                revealed=True,
            )
        )
    )

    assert row.row["status"] == SITE_OPEN
    assert datetime.fromisoformat(row.row["revealed_at"]).timestamp() * 1000 == REVEALED_MS
    assert row.row["limit_seconds"] == 3600
    assert row.row["participant_uids"] == [PLAYER_A, PLAYER_B]


def test_a_site_without_an_expiry_or_a_server_is_not_guessed_at() -> None:
    assert site_rows(viewport(site_point(with_expiry=False))) == []
    assert site_rows(viewport(site_point(server=None))) == []


def test_the_same_site_from_two_viewports_is_one_key_but_a_lit_one_is_new() -> None:
    first = site_rows(viewport(site_point()))[0].idempotency_key
    again = {r.idempotency_key for r in site_rows(viewport(site_point(x=460, y=280), site_point()))}
    lit = site_rows(viewport(site_point(status=0)))[0].idempotency_key

    assert first in again
    assert lit != first


def test_a_site_row_does_not_displace_the_viewport_or_city_rows() -> None:
    rows = world_map.normalize(viewport(site_point()))

    assert [r.target_table for r in rows] == ["world_viewport_snapshots", "season_site_snapshots"]
