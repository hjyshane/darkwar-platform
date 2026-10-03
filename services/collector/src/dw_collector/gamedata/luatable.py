"""The client's datatables: compiled Lua 5.4 chunks that return one table.

Each `*.bytes` datatable is Lua 5.4 bytecode with ONE byte inserted after the
`\\x1bLua` signature (`\\x1bLua\\x03T...` where stock Lua writes `\\x1bLuaT`).
Removing it leaves a chunk stock Lua 5.4 loads. Run, it returns

    { data  = { [id] = { v1, v2, ... }, ... },
      index = { column_name = { position, type_name }, ... } }

so a row is positional and `index` names the positions.

The chunk runs with an EMPTY environment — no `os`, `io`, `require`, not
even `print` — so it can build its table and nothing else. That limits what
it can call, not what bytecode can do to the interpreter: Lua does not verify
bytecode. These are the game's own files from the user's own device, which
is the trust this rests on.

lupa is the `gamedata` extra, imported here and nowhere else.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SIGNATURE = b"\x1bLua"
INSERTED = 0x03

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


def repair_header(data: bytes) -> bytes:
    """Stock Lua 5.4 bytecode, whether or not the extra byte is there."""
    if data[: len(SIGNATURE)] != SIGNATURE:
        raise DatatableError("not a Lua chunk")
    if data[len(SIGNATURE)] == INSERTED:
        return data[: len(SIGNATURE)] + data[len(SIGNATURE) + 1 :]
    return data


def _plain(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def decode(data: bytes, name: str = "datatable") -> Datatable:
    from lupa.lua54 import LuaRuntime

    # encoding=None: Lua strings come back as bytes and are decoded here,
    # leniently, so one odd byte in a game string cannot fail the table.
    lua = LuaRuntime(
        encoding=None,
        unpack_returned_tuples=True,
        register_eval=False,
        register_builtins=False,
    )
    result = lua.eval(_RUN)(repair_header(data), name.encode())
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
