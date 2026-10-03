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


# --- the catalogue (0209) -----------------------------------------------------

CATALOGUE_TABLES = {
    "goods": """return { data = {
        [253042] = { 253042, '300001', 5 },
        [200040] = { 200040, '300002', 4 } },
      index = { id = {1,'int'}, name = {2,'string'}, color = {3,'int'} } }""",
    "aps_resources": """return { data = { [25] = { 25, '300003' }, [12] = { 12, '300004' } },
      index = { id = {1,'int'}, name = {2,'string'} } }""",
    "building": """return { data = {
        [727079] = { 727079, '300005',
                     { {25, 0}, {12, 11400}, {26, 0} }, { {253042, 30} },
                     1267465, 285090 } },
      index = { id = {1,'int'}, name = {2,'string'}, cost_consume = {3,'table'},
                item = {4,'table'}, time = {5,'int'}, power = {6,'int'} } }""",
    "aps_science": """return { data = {
        [1108102] = { 1108102, 1108100, 2, '300006',
                      { {14, 94060000} }, { {200036, 4700} }, 423000 } },
      index = { id = {1,'int'}, science_id = {2,'int'}, level = {3,'int'}, name = {4,'string'},
                research_need = {5,'table'}, goods_need = {6,'table'}, time = {7,'int'} } }""",
    "car_equip": """return { data = { [1027] = { 1027, 1, 27, '200040;540|200041;110', '300007' } },
      index = { id = {1,'int'}, slot = {2,'int'}, level = {3,'int'},
                cost = {4,'string'}, name = {5,'string'} } }""",
    "pet_levelup": """return { data = { [226] = { 226, 3, 26, '330001;2475' } },
      index = { id = {1,'int'}, rarity = {2,'int'}, level = {3,'int'},
                cost_levelup = {4,'string'} } }""",
}
CATALOGUE_EN = (
    "300001=Precision Part\n300002=Titanium Alloy\n300003=Wood\n300004=Iron\n"
    "300006=Field Formation\n300007=Gun\n"
)
CATALOGUE_KO = "300001=정밀 부품\n"


def _catalogue():  # type: ignore[no-untyped-def]
    from dw_collector.gamedata.catalog import Catalog

    base = "assets/main/datatable"
    assets = {
        f"{base}/luatxt/luadatatable/{name}.bytes": _client_bytecode(src)
        for name, src in CATALOGUE_TABLES.items()
    }
    assets[f"{base}/localization/english/dictionaries/dialog_1.txt"] = CATALOGUE_EN.encode()
    assets[f"{base}/localization/korean/dictionaries/dialog_1.txt"] = CATALOGUE_KO.encode()
    return Catalog(assets)


def test_items_carry_both_languages_and_quality() -> None:
    items = {row["item_id"]: row for row in _catalogue().items()}

    assert items["253042"]["name"] == "Precision Part"
    assert items["253042"]["name_ko"] == "정밀 부품"
    assert items["253042"]["quality"] == 5
    assert items["200040"]["name_ko"] is None


def test_a_building_row_splits_into_type_and_level() -> None:
    (step,) = [s for s in _catalogue().steps() if s["kind"] == "building"]

    assert (step["subject_id"], step["level"]) == ("727000", 79)
    assert step["seconds"] == 1267465
    assert step["power"] == 285090


def test_costs_say_whether_they_are_resources_or_items_and_drop_zeros() -> None:
    """Resource 25 and item 25 are different things; a zero is no cost."""
    (step,) = [s for s in _catalogue().steps() if s["kind"] == "building"]

    assert step["costs"] == [
        {"type": "resource", "id": "12", "amount": 11400},
        {"type": "item", "id": "253042", "amount": 30},
    ]


def test_research_is_keyed_by_science_id_and_level() -> None:
    (step,) = [s for s in _catalogue().steps() if s["kind"] == "research"]

    assert (step["subject_id"], step["level"], step["name"]) == ("1108100", 2, "Field Formation")
    assert step["costs"] == [
        {"type": "resource", "id": "14", "amount": 94060000},
        {"type": "item", "id": "200036", "amount": 4700},
    ]


def test_string_costs_split_on_bar_and_semicolon() -> None:
    steps = {s["kind"]: s for s in _catalogue().steps()}

    assert steps["vehicle_part"]["costs"] == [
        {"type": "item", "id": "200040", "amount": 540},
        {"type": "item", "id": "200041", "amount": 110},
    ]
    assert (steps["vehicle_part"]["subject_id"], steps["vehicle_part"]["level"]) == ("1", 27)
    assert steps["pet"]["costs"] == [{"type": "item", "id": "330001", "amount": 2475}]
    assert steps["pet"]["subject_id"] == "3"


def test_hero_names_fill_only_what_nobody_typed() -> None:
    """The game's name fills a null or a hero the catalogue has never seen;
    a name an admin typed stays, even where the game spells it differently."""
    import json

    import httpx

    from dw_collector.gamedata.upload import fill_hero_names

    sent: list[list[dict[str, object]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {"hero_id": 12001, "name": "Barnett (typed)"},
                    {"hero_id": 21001, "name": None},
                ],
            )
        sent.append(json.loads(request.content))
        return httpx.Response(201)

    client = httpx.Client(base_url="http://test", transport=httpx.MockTransport(handler))
    written, kept = fill_hero_names(client, {12001: "Barnett", 21001: "Tristan", 40002: "Liz"})

    assert (written, kept) == (2, 1)
    assert sent == [[{"hero_id": 21001, "name": "Tristan"}, {"hero_id": 40002, "name": "Liz"}]]
