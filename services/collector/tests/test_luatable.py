"""Both datatable formats the client has shipped (gamedata/luatable.py).

The client's own files cannot be committed, so every chunk here is a small
Lua table compiled on the spot by lupa and then put in the client's form:

- 5.4: stock 5.4 bytecode with the byte 0x03 after the signature;
- 5.5: stock 5.5 bytecode with the marker 0xa8 after the signature, every pad
  recomputed as if the marker were part of the chunk, and every opcode
  renumbered the way build 1.250.672 numbers it, aliases included.

The Lua tests need the `gamedata` extra and skip without it.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from dw_collector.gamedata.luatable import (
    CLIENT_OPCODES,
    HEADER_55,
    LUA54,
    LUA55,
    OPCODE_MASK,
    STOCK_55,
    Datatable,
    DatatableError,
    Renumbering,
    decode,
    rewrite_55,
    stock_bytecode,
)

MARKER = 0xA8

# Every opcode a datatable uses: a shared empty table (MOVE), small and large
# integers (LOADI, LOADK), whole and fractional floats (LOADF, LOADK),
# booleans, a nil, a big key (LOADK + SETTABLE), a small one (SETI), named
# fields (SETFIELD), and nested constructors (NEWTABLE, EXTRAARG, SETLIST).
TABLE = """
local empty = {}
return {
  data = {
    [1] = { 1, 'first', 2.0, 3.5, true, false, nil, empty },
    [300004] = { 300004, 'second', -7.0, 0.25, false, true, 'note', { 10, 20 } },
  },
  index = {
    id = { 1, 'int' }, name = { 2, 'string' }, whole = { 3, 'float' },
    ratio = { 4, 'float' }, on = { 5, 'bool' }, off = { 6, 'bool' },
    note = { 7, 'string' }, costs = { 8, 'table' },
  },
}
"""

EXPECTED = Datatable(
    columns=("id", "name", "whole", "ratio", "on", "off", "note", "costs"),
    rows={
        "1": {
            "id": 1,
            "name": "first",
            "whole": 2,
            "ratio": 3.5,
            "on": True,
            "off": False,
            "note": None,
            "costs": [],
        },
        "300004": {
            "id": 300004,
            "name": "second",
            "whole": -7,
            "ratio": 0.25,
            "on": False,
            "off": True,
            "note": "note",
            "costs": [10, 20],
        },
    },
)

# Long enough for the things a three-row table never reaches: a code size
# past one varint byte, constants past 255, and absolute line info, the
# second place Lua 5.5 pads.
LONG_ROWS = 90
LONG = (
    "return {\n  data = {\n"
    + "".join(f"    [{1000 + n}] = {{ {1000 + n}, 'row {n}', {n}.5 }},\n" for n in range(LONG_ROWS))
    + "  },\n  index = { id = { 1, 'int' }, name = { 2, 'string' }, x = { 3, 'float' } },\n}\n"
)


def _dump(version: str, source: str) -> bytes:
    lupa = pytest.importorskip(f"lupa.lua{version}")
    lua = lupa.LuaRuntime(encoding=None)
    dumped: bytes = lua.eval(b"function(src) return string.dump(load(src)) end")(source.encode())
    return dumped


def client_54(source: str) -> bytes:
    """Compile like the client shipped it until 1.250.672."""
    stock = _dump("54", source)
    return stock[:4] + b"\x03" + stock[4:]


def _to_client() -> Renumbering:
    """Stock numbering to the client's. The low byte also carries the lowest
    bit of A; an odd A takes the opcode's first alias, so a chunk holds both
    the 0..84 number and an alias of the same opcode."""
    numbers = {STOCK_55[name]: codes for name, codes in CLIENT_OPCODES[MARKER].items()}
    rewrite = {}
    for low in range(256):
        codes = numbers.get(low & OPCODE_MASK)
        if codes:
            rewrite[low] = (low & ~OPCODE_MASK) | codes[(low >> 7) % len(codes)]
    return Renumbering.from_low_bytes(rewrite)


def client_55(source: str) -> bytes:
    """Compile like the client ships it from 1.250.672 on."""
    stock = _dump("55", source)
    header = HEADER_55[:4] + bytes([MARKER]) + HEADER_55[4:]
    return rewrite_55(stock, len(HEADER_55), header, _to_client())


def test_the_55_header_is_what_stock_lua_writes() -> None:
    assert _dump("55", "return {}").startswith(HEADER_55)


@pytest.mark.parametrize("encode", [client_54, client_55], ids=["lua54", "lua55"])
def test_a_datatable_decodes_in_either_format(encode: Callable[[str], bytes]) -> None:
    assert decode(encode(TABLE), "table") == EXPECTED


@pytest.mark.parametrize("encode", [client_54, client_55], ids=["lua54", "lua55"])
def test_a_long_datatable_decodes_in_either_format(encode: Callable[[str], bytes]) -> None:
    table = decode(encode(LONG), "long")

    assert len(table.rows) == LONG_ROWS
    assert table.rows["1089"] == {"id": 1089, "name": "row 89", "x": 89.5}


def test_the_version_byte_picks_the_format() -> None:
    assert stock_bytecode(client_54(TABLE))[0] == LUA54
    assert stock_bytecode(client_55(TABLE))[0] == LUA55


@pytest.mark.parametrize("source", [TABLE, LONG], ids=["table", "long"])
def test_the_55_rewrite_gives_back_exactly_what_stock_lua_wrote(source: str) -> None:
    """Pads, varints, strings and every instruction survive the round trip."""
    client = client_55(source)

    assert client[4] == MARKER
    assert stock_bytecode(client)[1] == _dump("55", source)


def test_the_client_chunk_really_is_renumbered() -> None:
    """Otherwise the round trip above would prove nothing about the numbers."""
    client, stock = client_55(TABLE), _dump("55", TABLE)
    # Both put the first instruction (VARARGPREP) at offset 48: the client
    # after one byte more of header and one byte less of padding.
    assert stock[47] == 0
    assert client[48] == CLIENT_OPCODES[MARKER]["VARARGPREP"][0] != stock[48]
    assert any(low & OPCODE_MASK >= 85 for low in client[48::4][:40])


def test_an_opcode_a_datatable_never_uses_is_refused() -> None:
    """An unmapped number could mean anything, so nothing runs."""
    chunk = bytearray(client_55(TABLE))
    assert chunk[48] == CLIENT_OPCODES[MARKER]["VARARGPREP"][0]
    chunk[48] = 0

    with pytest.raises(DatatableError, match="opcode 0 is not one a datatable uses"):
        decode(bytes(chunk), "unmapped")


def test_a_marker_whose_numbering_is_unknown_is_refused() -> None:
    chunk = bytearray(client_55(TABLE))
    chunk[4] = 0x42

    with pytest.raises(DatatableError, match="marker 0x42"):
        decode(bytes(chunk), "reshuffled")


def test_a_stock_55_chunk_is_refused() -> None:
    """Stock numbering without the marker is not something the client writes."""
    with pytest.raises(DatatableError, match="no marker"):
        decode(_dump("55", TABLE), "stock")


@pytest.mark.parametrize("cut", [1, 60, 200])
def test_a_truncated_55_chunk_is_refused(cut: int) -> None:
    chunk = client_55(TABLE)

    with pytest.raises(DatatableError):
        decode(chunk[:-cut], "truncated")


def test_something_that_is_not_lua_is_refused() -> None:
    with pytest.raises(DatatableError, match="not a Lua chunk"):
        stock_bytecode(b"PK\x03\x04zip")


def test_the_client_numbering_is_a_permutation_with_aliases() -> None:
    """0..84 renumber the 85 stock opcodes one to one; 85..127 are aliases."""
    for numbering in CLIENT_OPCODES.values():
        codes = [code for numbers in numbering.values() for code in numbers]
        assert len(codes) == len(set(codes))
        assert set(numbering) <= set(STOCK_55)
        for first, *aliases in numbering.values():
            assert first < 85
            assert all(85 <= alias < 128 for alias in aliases)
