"""Reading the game client's data files: bundle prefix, datatable header,
localisation, event names, and what game-names writes.

The client's own files cannot be committed, so the datatable here is a Lua
table compiled on the spot, with the client's extra header byte put back in.
The Lua tests need the `gamedata` extra and skip without it.
"""

from __future__ import annotations

import pytest

from dw_collector.gamedata import (
    DatatableError,
    event_names,
    localisation,
    repair_header,
    strip_prefix,
)
from dw_collector.gamedata.upload import NOTE, plan

ACTIVITY_PANEL = """
return {
  data = {
    [41101] = { 41101, 2, '200501' },
    [80002] = { 80002, 4, '200502' },
    [99999] = { 99999, 1, '999999' },
  },
  index = { id = { 1, 'int' }, type = { 2, 'int' }, name = { 3, 'string' } },
}
"""

STRINGS_EN = "200501=Arctic Ice Pit\n200502=Black Gold Battlefield\nnot a line\n"
STRINGS_KO = "200501=극지 얼음 구덩이\n"


def _client_bytecode(source: str) -> bytes:
    """Compile like the client ships it: stock 5.4 plus one byte."""
    lupa = pytest.importorskip("lupa.lua54")
    lua = lupa.LuaRuntime(encoding=None)
    stock = lua.eval(b"function(src) return string.dump(load(src)) end")(source.encode())
    return stock[:4] + b"\x03" + stock[4:]


def _assets(panel: bytes) -> dict[str, bytes]:
    base = "assets/main/datatable"
    return {
        f"{base}/luatxt/luadatatable/activity_panel.bytes": panel,
        f"{base}/localization/english/dictionaries/dialog_1.txt": STRINGS_EN.encode(),
        f"{base}/localization/korean/dictionaries/dialog_1.txt": STRINGS_KO.encode(),
    }


def test_the_bundle_prefix_is_removed_once() -> None:
    assert strip_prefix(b"UnityRawUnityFS\x00rest") == b"UnityFS\x00rest"
    assert strip_prefix(b"UnityFS\x00rest") == b"UnityFS\x00rest"


def test_the_inserted_header_byte_is_removed() -> None:
    assert repair_header(b"\x1bLua\x03T\x00rest") == b"\x1bLuaT\x00rest"
    assert repair_header(b"\x1bLuaT\x00rest") == b"\x1bLuaT\x00rest"


def test_something_that_is_not_lua_is_refused() -> None:
    with pytest.raises(DatatableError):
        repair_header(b"PK\x03\x04zip")


def test_localisation_reads_one_language_across_slices() -> None:
    assets = _assets(b"")
    assets["assets/main/datatable/localization/english/dictionaries/dialog_2.txt"] = b"7=Arena\n"

    english = localisation(assets, "English")
    korean = localisation(assets, "Korean")

    assert english == {"200501": "Arctic Ice Pit", "200502": "Black Gold Battlefield", "7": "Arena"}
    assert korean == {"200501": "극지 얼음 구덩이"}


def test_event_names_follow_the_client_two_lookups() -> None:
    """id -> activity_panel.name -> localisation. An id whose key has no
    string is left out rather than named after its key."""
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)))

    assert names == {"41101": "Arctic Ice Pit", "80002": "Black Gold Battlefield"}


def test_names_come_in_the_language_asked_for() -> None:
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)), "Korean")

    assert names == {"41101": "극지 얼음 구덩이"}


def test_a_chunk_that_reaches_for_os_fails_instead_of_running() -> None:
    """The chunk runs with an empty environment."""
    from dw_collector.gamedata import decode

    with pytest.raises(DatatableError):
        decode(_client_bytecode("return os.time()"), "hostile")


def test_plan_writes_new_names() -> None:
    result = plan([], {"41101": "Arctic Ice Pit"})

    assert result.to_write == [{"activity_id": "41101", "name": "Arctic Ice Pit", "note": NOTE}]


def test_plan_never_overwrites_an_officers_name() -> None:
    existing = [{"activity_id": "41101", "name": "Ice Pit", "updated_by": "user-uuid"}]

    result = plan(existing, {"41101": "Arctic Ice Pit"})

    assert result.to_write == []
    assert result.kept_human == 1


def test_plan_refreshes_its_own_names_and_skips_unchanged_ones() -> None:
    existing = [
        {"activity_id": "41101", "name": "Old Ice Pit", "updated_by": None},
        {"activity_id": "80002", "name": "Black Gold Battlefield", "updated_by": None},
    ]

    result = plan(existing, {"41101": "Arctic Ice Pit", "80002": "Black Gold Battlefield"})

    assert [row["activity_id"] for row in result.to_write] == ["41101"]
    assert result.unchanged == 1
