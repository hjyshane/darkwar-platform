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
from dw_collector.gamedata.names import EventName, classify
from dw_collector.gamedata.upload import NOTE, plan

ACTIVITY_PANEL = """
return {
  data = {
    [41101] = { 41101, 2, '200501' },
    [80002] = { 80002, 4, '200502' },
    [300004] = { 300004, 274, '200503' },
    [99999] = { 99999, 1, '999999' },
  },
  index = { id = { 1, 'int' }, type = { 2, 'int' }, name = { 3, 'string' } },
}
"""

STRINGS_EN = (
    "200501=Arctic Ice Pit\n200502=Black Gold Battlefield\n200503=Mod Vehicle Combo Pack\n"
    "not a line\n"
)
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

    assert english == {
        "200501": "Arctic Ice Pit",
        "200502": "Black Gold Battlefield",
        "200503": "Mod Vehicle Combo Pack",
        "7": "Arena",
    }
    assert korean == {"200501": "극지 얼음 구덩이"}


def test_event_names_follow_the_client_two_lookups() -> None:
    """id -> activity_panel.name -> localisation. An id whose key has no
    string is left out rather than named after its key."""
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)))

    assert {k: v.name for k, v in names.items()} == {
        "41101": "Arctic Ice Pit",
        "80002": "Black Gold Battlefield",
        "300004": "Mod Vehicle Combo Pack",
    }


def test_a_pack_is_premium_and_a_battle_is_an_event() -> None:
    """The category comes from the activity type, not the in-game tab."""
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)))

    assert (names["300004"].activity_type, names["300004"].category) == (274, "premium")
    assert (names["80002"].activity_type, names["80002"].category) == (4, "event")


def test_the_category_is_read_from_the_english_name() -> None:
    """A Korean run classifies like an English one."""
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)), "Korean")

    assert names["41101"].category == "event"


@pytest.mark.parametrize(
    ("activity_id", "kind", "name", "category"),
    [
        ("111001", 54, "Capital Clash", "major"),
        ("80002", 71, "Black Gold Battlefield", "major"),
        ("111401", 210, "Bio-Mutant", "major"),
        ("55000", 14, "Alliance Duel", "recurring"),
        ("4000401", 23, "Tyrant-C Comes", "recurring"),
        ("4009603", 18, "Tyrant-V Comes", "recurring"),
        ("50004", 119, "Survival Preparedness", "recurring"),
        ("41101", 126, "Arctic Ice Pit", "season"),
        ("40724", 239, "Endless Night", "season"),
        ("40735", 25, "Arctic Veins", "season"),
        ("492000", 1008, "Frozen Rescue", "season"),
        ("70030", 45, "Season Pass", "season"),
        ("104012", 250, "Celebration Shop", "season"),
        ("104024", 20, "Survivor Market", "season"),
        ("104001", 40, "Celebration Trial", "season"),
        ("2010", 288, "Custom Weekly Pass", "pass"),
        ("2008", 109, "Event Monthly Pass", "pass"),
        ("40514", 20, "Industrial Surge", "pass"),
        ("590007", 27, "Equipment Battle Pass", "pass"),
        ("1", 27, "Rise of Industry", "pass"),
        ("600001", 27, "Catherine's Gift", "premium"),
        ("300004", 274, "Mod Vehicle Combo Pack", "premium"),
        ("55513", 18, "Wrath of King Scorpion", "event"),
        ("9001", 2, "Shadow Calls", "event"),
    ],
)
def test_calendar_categories(activity_id: str, kind: int, name: str, category: str) -> None:
    assert classify(activity_id, kind, name) == category


def test_names_come_in_the_language_asked_for() -> None:
    names = event_names(_assets(_client_bytecode(ACTIVITY_PANEL)), "Korean")

    assert {k: v.name for k, v in names.items()} == {"41101": "극지 얼음 구덩이"}


def test_a_chunk_that_reaches_for_os_fails_instead_of_running() -> None:
    """The chunk runs with an empty environment."""
    from dw_collector.gamedata import decode

    with pytest.raises(DatatableError):
        decode(_client_bytecode("return os.time()"), "hostile")


def _named(name: str, kind: int = 2, category: str = "event") -> EventName:
    return EventName(name, kind, category)


def test_plan_writes_new_names_with_their_category() -> None:
    result = plan([], {"300004": _named("Mod Vehicle Combo Pack", 274, "premium")})

    assert result.to_write == [
        {
            "activity_id": "300004",
            "name": "Mod Vehicle Combo Pack",
            "note": NOTE,
            "activity_type": 274,
            "category": "premium",
        }
    ]


def test_plan_never_overwrites_an_officers_name_or_category() -> None:
    existing = [
        {
            "activity_id": "41101",
            "name": "Ice Pit",
            "updated_by": "u",
            "activity_type": 2,
            "category": "premium",
        }
    ]

    result = plan(existing, {"41101": _named("Arctic Ice Pit")})

    assert result.to_write == []
    assert result.to_classify == []
    assert result.kept_human == 1


def test_plan_fills_the_game_facts_on_an_officers_row() -> None:
    """Named before categories existed: the type and a category are added,
    the name is not touched."""
    existing = [{"activity_id": "41101", "name": "Ice Pit", "updated_by": "u"}]

    result = plan(existing, {"41101": _named("Arctic Ice Pit", 2, "event")})

    assert result.to_classify == [{"activity_id": "41101", "activity_type": 2, "category": "event"}]


def test_plan_refreshes_its_own_rows_and_skips_unchanged_ones() -> None:
    existing = [
        {
            "activity_id": "41101",
            "name": "Old Ice Pit",
            "updated_by": None,
            "activity_type": 2,
            "category": "event",
        },
        {
            "activity_id": "80002",
            "name": "Black Gold Battlefield",
            "updated_by": None,
            "activity_type": 4,
            "category": "event",
        },
    ]

    result = plan(
        existing,
        {"41101": _named("Arctic Ice Pit"), "80002": _named("Black Gold Battlefield", 4)},
    )

    assert [row["activity_id"] for row in result.to_write] == ["41101"]
    assert result.unchanged == 1


# --- the catalogue (0209) -----------------------------------------------------

CATALOGUE_TABLES = {
    "goods": """return { data = {
        [253042] = { 253042, '300001', 5 },
        [200040] = { 200040, '300002', 4 },
        [210872] = { 210872, '', 2, { ['300010'] = '10,000' } },
        [222003] = { 222003, '300011', 2, { ['300011'] = '100' } } },
      index = { id = {1,'int'}, name = {2,'string'}, color = {3,'int'},
                name_value = {4,'table'} } }""",
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
    "300006=Field Formation\n300007=Gun\n300010={0} Coins\n300011={0} VIP Points\n"
)
CATALOGUE_KO = "300001=정밀 부품\n300010=코인 {0}\n"


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
    written, kept = fill_hero_names(
        client,
        {12001: "Barnett", 21001: "Tristan", 40002: "Liz", 50001: "barnett (TYPED)"},
    )

    # 50001's name is already 12001's, case-insensitively: left alone.
    assert (written, kept) == (2, 1)
    assert sent == [[{"hero_id": 21001, "name": "Tristan"}, {"hero_id": 40002, "name": "Liz"}]]


def test_hero_names_keep_only_playable_heroes_with_one_name() -> None:
    from dw_collector.gamedata.catalog import Catalog

    base = "assets/main/datatable"
    table = """return { data = {
        [121] = { 121, '400001' }, [122] = { 122, '400001' },
        [12001] = { 12001, '400002' }, [1007] = { 1007, '400003' },
        [99998] = { 99998, '400003' }, [30001] = { 30001, '400004' },
        [30002] = { 30002, '400004' } },
      index = { id = {1,'int'}, name = {2,'string'} } }"""
    strings = "400001=Elite Zombie\n400002=Barnett\n400003=Bob\n400004=Twin\n"
    catalog = Catalog(
        {
            f"{base}/luatxt/luadatatable/aps_new_heroes.bytes": _client_bytecode(table),
            f"{base}/localization/english/dictionaries/dialog_1.txt": strings.encode(),
        }
    )

    # Monsters (<1000) and the 99998 test copy are out; Bob keeps 1007;
    # "Twin" names two playable ids, so neither is guessed.
    assert catalog.hero_names() == {12001: "Barnett", 1007: "Bob"}


def test_items_named_by_template_take_their_number() -> None:
    """Resource crates, speedups and VIP points are named "{0} Coins" plus
    a number in `name_value`, not by a plain name."""
    items = {row["item_id"]: row for row in _catalogue().items()}

    assert (items["210872"]["name"], items["210872"]["name_ko"]) == ("10,000 Coins", "코인 10,000")
    assert items["222003"]["name"] == "100 VIP Points"
