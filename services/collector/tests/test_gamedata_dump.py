"""game-dump: every client datatable, laid out for the admin browser (0343).

The datatables are compiled on the spot like the client ships them, so
these need the `gamedata` extra and skip without it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dw_collector.gamedata.dump import (
    CHUNK,
    build,
    chunks,
    datatables,
    dump_table,
    loc_columns,
    metadata_row,
    write_json,
)
from dw_collector.gamedata.luatable import Datatable

GOODS = """
return {
  data = {
    [230101] = { 230101, '300001', 'tag', 4, 230101 },
    [230102] = { 230102, '300002', '', 3, 230102 },
    [230103] = { 230103, '300099', 'x', 2, 230103 },
  },
  index = {
    id = { 1, 'int' }, name = { 2, 'string' }, note = { 3, 'string' },
    quality = { 4, 'int' }, loop_id = { 5, 'int' },
  },
}
"""
GIFT = """
return {
  data = {
    [1] = { 1, 230101, { 230101, 230102 } },
    [2] = { 2, 230102, { items = { 230101 } } },
  },
  index = { id = { 1, 'int' }, item_id = { 2, 'int' }, bundle = { 3, 'table' } },
}
"""
BROKEN = b"\x1bLua\x03Tjunk"

EN = "300001=Precision Part\n300002=Titanium Alloy\n230101=Not an item name\n"
KO = "300001=정밀 부품\n"


def _bytecode(source: str) -> bytes:
    lupa = pytest.importorskip("lupa.lua54")
    lua = lupa.LuaRuntime(encoding=None)
    stock = lua.eval(b"function(src) return string.dump(load(src)) end")(source.encode())
    return bytes(stock[:4] + b"\x03" + stock[4:])


def _assets() -> dict[str, bytes]:
    base = "assets/main/datatable"
    return {
        f"{base}/luatxt/luadatatable/goods.bytes": _bytecode(GOODS),
        f"{base}/luatxt/luadatatable/gift.bytes": _bytecode(GIFT),
        f"{base}/luatxt/luadatatable/broken.bytes": BROKEN,
        f"{base}/localization/english/dictionaries/dialog_0.txt": EN.encode(),
        f"{base}/localization/korean/dictionaries/dialog_0.txt": KO.encode(),
    }


def _plain_table() -> Datatable:
    rows = {
        "230101": {"id": 230101, "name": "300001", "note": "tag", "quality": 4, "loop_id": 230101},
        "230102": {"id": 230102, "name": "300002", "note": "", "quality": 3, "loop_id": 230102},
        "230103": {"id": 230103, "name": "300099", "note": "x", "quality": 2, "loop_id": 230103},
    }
    return Datatable(("id", "name", "note", "quality", "loop_id"), rows)


EN_KEYS = {"300001": "Precision Part", "300002": "Titanium Alloy", "230101": "Not an item name"}


def test_a_column_is_localised_when_most_of_its_values_are_keys() -> None:
    # name: 2 of 3 values are keys (300099 is not) -> 0.67, below the share.
    # Raising the fixture to 3 of 3 is what makes it localised.
    keys = {**EN_KEYS, "300099": "Wood"}
    assert loc_columns(_plain_table(), keys) == ("name",)


def test_id_is_never_localised_even_when_it_collides_with_a_key() -> None:
    # 230101 is both a row id and a string key; `id` and `loop_id` are ids
    # by name and stay numbers whichever way the dictionary happens to fall.
    keys = {**EN_KEYS, "230102": "a", "230103": "b", "300099": "c"}
    assert loc_columns(_plain_table(), keys) == ("name",)


def test_strings_are_only_the_keys_the_table_uses_in_each_language() -> None:
    table = _plain_table()
    dump = dump_table(
        "goods", table, {"en": {**EN_KEYS, "300099": "Wood"}, "ko": {"300001": "정밀 부품"}}
    )
    assert dump.strings == {
        "en": {"300001": "Precision Part", "300002": "Titanium Alloy", "300099": "Wood"},
        "ko": {"300001": "정밀 부품"},
    }


def test_the_name_index_carries_both_languages_and_tolerates_a_missing_one() -> None:
    dump = dump_table(
        "goods",
        _plain_table(),
        {"en": {**EN_KEYS, "300099": "Wood"}, "ko": {"300001": "정밀 부품"}},
    )
    assert dump.names == (
        ("230101", "Precision Part", "정밀 부품"),
        ("230102", "Titanium Alloy", None),
        ("230103", "Wood", None),
    )


def test_a_table_without_a_name_column_has_no_index_entries() -> None:
    table = Datatable(("id", "value"), {"1": {"id": 1, "value": 10}})
    assert dump_table("plain", table, {"en": EN_KEYS, "ko": {}}).names == ()


def test_rows_are_chunked_in_numeric_id_order() -> None:
    rows = {str(i): {"id": i} for i in range(CHUNK + 2, 0, -1)}
    dump = dump_table("big", Datatable(("id",), rows), {"en": {}, "ko": {}})
    pieces = chunks(dump)
    assert [len(piece) for piece in pieces] == [CHUNK, 2]
    assert list(pieces[0])[:3] == ["1", "2", "3"]
    assert list(pieces[1]) == [str(CHUNK + 1), str(CHUNK + 2)]
    assert metadata_row(dump, "v", __import__("datetime").datetime.now())["chunk_count"] == 2


def test_build_reads_every_datatable_and_reports_the_ones_that_fail() -> None:
    dump = build(_assets())
    assert [table.name for table in dump.tables] == ["gift", "goods"]
    assert list(dump.failures) == ["broken"]
    goods = next(table for table in dump.tables if table.name == "goods")
    assert goods.loc_columns == ()  # 300099 is unknown: 2 of 3, under the share
    gift = next(table for table in dump.tables if table.name == "gift")
    # Nested Lua tables survive as lists and dicts.
    assert gift.rows["1"]["bundle"] == [230101, 230102]
    assert gift.rows["2"]["bundle"] == {"items": [230101]}


def test_only_limits_the_tables_decoded() -> None:
    dump = build(_assets(), only=["gift"])
    assert [table.name for table in dump.tables] == ["gift"]
    assert dump.failures == {}


def test_datatables_are_found_by_their_folder_not_their_bundle() -> None:
    assets = _assets()
    assets["assets/other/thing.bytes"] = b""
    assert sorted(datatables(assets)) == ["broken", "gift", "goods"]


def test_write_json_lays_out_an_index_and_one_file_per_table(tmp_path: Path) -> None:
    dump = build(_assets(), only=["gift"])
    write_json(dump, tmp_path, "1645")
    index = json.loads((tmp_path / "index.json").read_text("utf-8"))
    assert index["client_version"] == "1645"
    assert [t["name"] for t in index["tables"]] == ["gift"]
    assert index["tables"][0]["row_count"] == 2
    document = json.loads((tmp_path / "tables" / "gift.json").read_text("utf-8"))
    assert document["columns"] == ["id", "item_id", "bundle"]
    assert document["rows"]["2"]["item_id"] == 230102
