"""The client's datatables: compiled Lua chunks that return one table.

Run, a datatable returns

    { data  = { [id] = { v1, v2, ... }, ... },
      index = { column_name = { position, type_name }, ... } }

so a row is positional and `index` names the positions.

The client writes ONE byte after the `\\x1bLua` signature that stock Lua does
not, and the Lua version byte after it tells the two formats apart:

- **Lua 5.4** (`\\x1bLua\\x03T...`, every build before 1.250.672). Removing
  the byte leaves a chunk stock Lua 5.4 loads.
- **Lua 5.5** (`\\x1bLua\\xa8U...`, build 1.250.672 of 2026-11-17 onward).
  Removing the byte is not enough, for two reasons:

  1. Lua 5.5 pads the code vector (and absolute line info) to a 4-byte
     boundary counted from the first byte of the chunk, and the client
     counts its extra byte. With the byte gone every pad is one byte off and
     stock Lua reads garbage — "bad binary format (invalid constant)". So the
     chunk is copied field by field and each pad is recomputed.
  2. The client's Lua renumbers its opcodes. The 7-bit opcode field takes 128
     values: 0..84 are a permutation of the 85 stock opcodes and 85..127 are
     aliases, so one datatable writes SETFIELD as both 44 and 109. Each
     instruction's opcode is translated to the stock number on the way.

  The translation (`CLIENT_OPCODES`) was read from the client's own
  `libxlua.so` (x86_64, build 1.250.672): `luaV_execute` dispatches through a
  128-entry table of handler addresses, and each handler's machine code says
  what it is (LOADF converts sBx to a double and tags it 0x13, SETI keys by
  the B byte itself, …). Only the opcodes a datatable needs are mapped — the
  twelve the 479 datatables of that build use, plus LOADFALSE, LOADTRUE,
  LOADNIL and LOADKX for boolean, nil and very large tables. Any other opcode
  is refused, not guessed: Lua does not verify bytecode, and a table builder
  has no business calling anything. The translation is keyed by the marker
  byte, so a client that reshuffles under a new marker is refused too.
  docs/runbooks/game-data.md says how it was read and how to read it again.

The chunk runs with an EMPTY environment — no `os`, `io`, `require`, not
even `print` — so it can build its table and nothing else. That limits what
it can call, not what bytecode can do to the interpreter. These are the
game's own files from the user's own device, which is the trust this rests
on; for 5.5 the opcode allowlist narrows it further.

lupa is the `gamedata` extra, imported here and nowhere else.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any

SIGNATURE = b"\x1bLua"
INSERTED = 0x03

LUA54 = 0x54
LUA55 = 0x55

_RUNTIMES = {LUA54: "lupa.lua54", LUA55: "lupa.lua55"}

# What stock Lua 5.5 writes before the main function on a 64-bit
# little-endian machine: signature, version, format, LUAC_DATA, then the
# size and a check value of int, Instruction, lua_Integer and lua_Number.
# The client's header is this with its marker byte after the signature.
HEADER_55 = (
    b"\x1bLua\x55\x00\x19\x93\r\n\x1a\n"
    b"\x04\x88\xa9\xff\xff"
    b"\x04\x78\x56\x34\x12"
    b"\x08\x88\xa9\xff\xff\xff\xff\xff\xff"
    b"\x08\x00\x00\x00\x00\x00\x28\x77\xc0"
)

# Stock Lua 5.5 opcode numbers (lopcodes.h; lupa's lua55 uses the same).
STOCK_55 = {
    "MOVE": 0,
    "LOADI": 1,
    "LOADF": 2,
    "LOADK": 3,
    "LOADKX": 4,
    "LOADFALSE": 5,
    "LOADTRUE": 7,
    "LOADNIL": 8,
    "SETTABLE": 16,
    "SETI": 17,
    "SETFIELD": 18,
    "NEWTABLE": 19,
    "RETURN": 70,
    "SETLIST": 78,
    "VARARGPREP": 83,
    "EXTRAARG": 84,
}

# The client's numbers for those opcodes, by marker byte. The first number
# of each is the one in 0..84; the rest are its aliases.
CLIENT_OPCODES: dict[int, dict[str, tuple[int, ...]]] = {
    0xA8: {
        "MOVE": (70, 85, 86, 87, 120),
        "LOADI": (81, 90),
        "LOADF": (59, 91),
        "LOADK": (1, 88, 89, 121),
        "LOADKX": (35,),
        "LOADFALSE": (16, 92),
        "LOADTRUE": (27, 93),
        "LOADNIL": (75, 94, 95, 126),
        "SETTABLE": (4, 106, 107, 124),
        "SETI": (32, 108),
        "SETFIELD": (44, 109),
        "NEWTABLE": (25,),
        "RETURN": (78,),
        "SETLIST": (63,),
        "VARARGPREP": (34,),
        "EXTRAARG": (45,),
    },
}

OPCODE_MASK = 0x7F

_RUN = b"""
function(code, name)
  local fn, err = load(code, name, 'b', {})
  if not fn then return nil, err end
  local ok, value = pcall(fn)
  if not ok then return nil, tostring(value) end
  return value
end
"""


class DatatableError(RuntimeError):
    pass


@dataclass(frozen=True)
class Datatable:
    columns: tuple[str, ...]
    rows: dict[str, dict[str, Any]]


@dataclass(frozen=True)
class Renumbering:
    """A rewrite of each instruction's low byte, where the opcode lives.

    The low byte also holds the lowest bit of A, so `table` has 256 entries
    for `bytes.translate`; `allowed` lists the low bytes it may rewrite.
    """

    table: bytes
    allowed: bytes

    @classmethod
    def from_low_bytes(cls, rewrite: dict[int, int]) -> Renumbering:
        table = bytearray(range(256))
        for low, new in rewrite.items():
            table[low] = new
        return cls(bytes(table), bytes(sorted(rewrite)))

    @classmethod
    def to_stock(cls, client: dict[str, tuple[int, ...]]) -> Renumbering:
        opcode: dict[int, int] = {}
        for name, codes in client.items():
            for code in codes:
                if code in opcode:
                    raise ValueError(f"client opcode {code} is mapped twice")
                opcode[code] = STOCK_55[name]
        return cls.from_low_bytes(
            {
                low: (low & ~OPCODE_MASK) | opcode[low & OPCODE_MASK]
                for low in range(256)
                if low & OPCODE_MASK in opcode
            }
        )


_TO_STOCK = {marker: Renumbering.to_stock(names) for marker, names in CLIENT_OPCODES.items()}


class _Rewriter:
    """Copies one Lua 5.5 chunk field by field (the order of lundump.c).

    `pos` counts input bytes from the chunk's first byte and `out` starts
    with the output's first byte, so each side pads to its own boundary.
    """

    def __init__(self, data: bytes, start: int, header: bytes, renumbering: Renumbering) -> None:
        self.data = data
        self.pos = start
        self.out = bytearray(header)
        self.renumbering = renumbering

    def take(self, n: int) -> bytes:
        end = self.pos + n
        if end > len(self.data):
            raise DatatableError("truncated chunk")
        chunk = self.data[self.pos : end]
        self.pos = end
        return chunk

    def copy(self, n: int) -> None:
        self.out += self.take(n)

    def varint(self) -> int:
        """Copy one varint: 7 bits a byte, high bit set while more follow."""
        value = 0
        for _ in range(10):
            byte = self.take(1)[0]
            self.out.append(byte)
            value = (value << 7) | (byte & 0x7F)
            if not byte & 0x80:
                return value
        raise DatatableError("varint too long")

    def align(self) -> None:
        if any(self.take(-self.pos % 4)):
            raise DatatableError("padding is not zero")
        self.out += bytes(-len(self.out) % 4)

    def string(self) -> None:
        size = self.varint()
        if size == 0:
            self.varint()  # index of a string saved earlier; 0 = none
        else:
            self.copy(size)  # the size counts the trailing NUL

    def code(self) -> None:
        n = self.varint()
        self.align()
        words = self.take(4 * n)
        lows = words[0::4]
        refused = lows.translate(None, self.renumbering.allowed)
        if refused:
            raise DatatableError(f"opcode {refused[0] & OPCODE_MASK} is not one a datatable uses")
        code = bytearray(words)
        code[0::4] = lows.translate(self.renumbering.table)
        self.out += code

    def function(self) -> None:
        self.varint()  # linedefined
        self.varint()  # lastlinedefined
        self.copy(3)  # numparams, flag, maxstacksize
        self.code()
        for _ in range(self.varint()):  # constants
            tag = self.take(1)[0]
            self.out.append(tag)
            if tag == 0x13:  # float
                self.copy(8)
            elif tag == 0x03:  # integer
                self.varint()
            elif tag in (0x04, 0x14):  # short and long string
                self.string()
            elif tag not in (0x00, 0x01, 0x11):  # nil, false, true
                raise DatatableError(f"invalid constant tag {tag:#04x}")
        upvalues = self.varint()
        self.copy(3 * upvalues)  # instack, idx, kind
        for _ in range(self.varint()):
            self.function()
        self.string()  # source
        self.copy(self.varint())  # lineinfo
        absolute = self.varint()
        if absolute:
            self.align()
            self.copy(8 * absolute)  # (pc, line) int pairs
        for _ in range(self.varint()):  # local variables
            self.string()
            self.varint()  # startpc
            self.varint()  # endpc
        if self.varint():  # upvalue names, when debug info was kept
            for _ in range(upvalues):
                self.string()

    def chunk(self) -> bytes:
        self.copy(1)  # upvalue count of the main closure
        self.function()
        if self.pos != len(self.data):
            raise DatatableError("bytes after the main function")
        return bytes(self.out)


def rewrite_55(data: bytes, start: int, header: bytes, renumbering: Renumbering) -> bytes:
    """`data` from offset `start` on, after `header`, opcodes renumbered."""
    return _Rewriter(data, start, header, renumbering).chunk()


def repair_header(data: bytes) -> bytes:
    """Stock Lua 5.4 bytecode, whether or not the extra byte is there."""
    if data[: len(SIGNATURE)] != SIGNATURE:
        raise DatatableError("not a Lua chunk")
    if data[len(SIGNATURE)] == INSERTED:
        return data[: len(SIGNATURE)] + data[len(SIGNATURE) + 1 :]
    return data


def stock_bytecode(data: bytes) -> tuple[int, bytes]:
    """(Lua version, a chunk stock Lua of that version loads)."""
    if data[: len(SIGNATURE)] != SIGNATURE or len(data) < len(SIGNATURE) + 2:
        raise DatatableError("not a Lua chunk")
    marker: int | None = data[len(SIGNATURE)]
    version = data[len(SIGNATURE)]
    if version in _RUNTIMES:
        marker = None
    else:
        version = data[len(SIGNATURE) + 1]
    if version == LUA54 and marker in (None, INSERTED):
        return LUA54, repair_header(data)
    if version == LUA55 and marker is not None:
        renumbering = _TO_STOCK.get(marker)
        if renumbering is None:
            raise DatatableError(
                f"Lua 5.5 chunk with marker {marker:#04x}, whose opcode numbering "
                "has not been read from the client (docs/runbooks/game-data.md)"
            )
        if data[len(SIGNATURE) + 1 : len(HEADER_55) + 1] != HEADER_55[len(SIGNATURE) :]:
            raise DatatableError("not the Lua 5.5 header of a 64-bit little-endian client")
        return LUA55, rewrite_55(data, len(HEADER_55) + 1, HEADER_55, renumbering)
    marked = "no marker" if marker is None else f"marker {marker:#04x}"
    raise DatatableError(f"unrecognised chunk: Lua version byte {version:#04x}, {marked}")


def _plain(value: Any, depth: int = 0) -> Any:
    """Lua values as Python ones. A nested table — some cells hold one, a
    cost list or a level curve — becomes a list when its keys run 1..n and a
    dict otherwise."""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if hasattr(value, "items") and depth < 8:
        items = [(_plain(k, depth + 1), _plain(v, depth + 1)) for k, v in value.items()]
        keys = [k for k, _ in items]
        if keys == list(range(1, len(keys) + 1)):
            return [v for _, v in items]
        return {str(k): v for k, v in items}
    return value


def decode(data: bytes, name: str = "datatable") -> Datatable:
    try:
        version, chunk = stock_bytecode(data)
    except DatatableError as exc:
        raise DatatableError(f"{name}: {exc}") from exc
    runtime = importlib.import_module(_RUNTIMES[version])

    # encoding=None: Lua strings come back as bytes and are decoded here,
    # leniently, so one odd byte in a game string cannot fail the table.
    lua = runtime.LuaRuntime(
        encoding=None,
        unpack_returned_tuples=True,
        register_eval=False,
        register_builtins=False,
    )
    result = lua.eval(_RUN)(chunk, name.encode())
    if isinstance(result, tuple):
        raise DatatableError(f"{name}: {_plain(result[1])}")
    try:
        index = {str(_plain(column)): int(spec[1]) for column, spec in result[b"index"].items()}
    except (TypeError, KeyError) as exc:
        raise DatatableError(f"{name}: no column index") from exc
    columns = tuple(sorted(index, key=index.__getitem__))
    rows: dict[str, dict[str, Any]] = {}
    for row_id, row in result[b"data"].items():
        rows[str(_plain(row_id))] = {column: _plain(row[index[column]]) for column in columns}
    return Datatable(columns, rows)
