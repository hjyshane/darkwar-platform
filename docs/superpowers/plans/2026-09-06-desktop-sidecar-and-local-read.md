# Desktop App: Sidecar Lifecycle and Local Read Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri window that answers "where is this player" from the user's own local SQLite journal, with the Python half provably dying whenever the window does.

**Architecture:** Two processes. Tauri (Rust) draws the window and owns the lifetime; a PyInstaller-packaged Python sidecar reads the local journal and serves JSON on a loopback port it chooses itself. Rust reads that port from the sidecar's first stdout line and proxies every call, so the webview never speaks HTTP and no CORS exists. The sidecar also exits on its own when its stdin closes, which is what makes an orphan impossible even if Rust dies badly.

**Tech Stack:** Python 3.12 (stdlib `http.server`, `sqlite3`), PyInstaller, Rust + Tauri v2, TypeScript + Vite, pytest, vitest.

---

## Scope

This plan covers ADR 0001 phases 0–2. It ends with a window that searches real
local data and leaves nothing running.

**Not in this plan** — each gets its own plan:
- Phase 3, settings UI (BlueStacks resolution, adapter, paths)
- Phase 4, map rendering and `packages/ui` extraction
- Phase 5, remaining screens (player, alliance, arena, boards)
- Phase 6, installer, Npcap wizard, auto-update, signing

## Background the engineer needs

**The local journal is not the cloud schema.** `services/collector/src/dw_collector/storage/journal.py`
defines four SQLite tables. Every one of the seventeen target tables lands as a
JSON blob in `normalized_rows`, tagged by `target_table`. There are no typed
columns. Reading it means `json.loads(row_json)["row"]` and pulling keys out by
hand — see `console/find.py:113` for the existing example.

Relevant columns:

```
raw_observations(observation_id, collector_id, source_command, captured_at,
                 collected_from_server_id, payload_json, created_at)
normalized_rows(id, observation_id, target_table, idempotency_key,
                row_json, created_at)
```

`captured_at` lives on `raw_observations`, not inside `row_json`, so every read
joins the two.

**One trap this repo has already paid for.** A sweep writes one row per tile per
pan, and pans overlap, so a single base appears many times. Deduplicate to one
row per player *before* applying any limit. Limit-then-dedupe silently drops
whole players — the same failure as `docs/adr` notes about PostgREST's 1000-row
cap, one level down. Task 3 has a test that pins this.

**Run everything from the right directory.** Python commands run in
`services/collector/`. Node and Rust commands run in `apps/desktop/`.

## File Structure

**Python — `services/collector/src/dw_collector/desktop/`** (new package)

| File | Responsibility |
|---|---|
| `__init__.py` | Empty marker. |
| `localread.py` | Read `normalized_rows` into typed objects. Knows SQL and JSON shape. No HTTP. |
| `sidecar.py` | HTTP surface and process lifetime. Knows ports and stdin. No SQL. |

The split matters: `localread` is the part every later screen grows, and it
must stay testable without starting a server.

**Tests — `services/collector/tests/`**

| File | Responsibility |
|---|---|
| `test_desktop_localread.py` | Journal fixtures → typed rows, dedupe, search. |
| `test_desktop_sidecar.py` | Routes, and that closing stdin ends the process. |

**Tauri — `apps/desktop/`** (new pnpm workspace member)

| File | Responsibility |
|---|---|
| `package.json` | Workspace member, Vite + Tauri CLI scripts. |
| `index.html`, `src/main.ts` | Spike UI: one input, one button, one output block. |
| `vite.config.ts`, `tsconfig.json` | Build config, fixed dev port 1420. |
| `src-tauri/Cargo.toml` | Rust deps. |
| `src-tauri/tauri.conf.json` | Window and bundle config, sidecar as `externalBin`. |
| `src-tauri/build.rs` | Tauri codegen. |
| `src-tauri/src/main.rs` | Spawn sidecar, read port, proxy commands, kill on exit. |

---

### Task 1: Local read layer — tiles out of the journal

> **Amended during execution (commit `2490d43`).** The `tiles()` body below is
> the version this task originally specified, and it was wrong: the `try`
> wrapped only `json.loads(raw)["row"]`, so a `row_json` holding valid JSON
> that is not an object reached `.get` and raised `AttributeError`, and a
> coordinate stored as a non-numeric string reached `int()` and raised
> `ValueError`. Both escaped the caught tuple and killed the whole read.
>
> The shipped version extracts a `_tile(raw, captured_at) -> Tile | None`
> helper wrapping the *entire* parse, catching
> `(ValueError, KeyError, TypeError, AttributeError)`. Three tests were added
> with it, so this task ends at **7 passing tests**, not 4 — which shifts
> Task 2 to 9 and Task 3 to 12. Read the file on disk rather than the block
> below if you are re-running this task.

**Files:**
- Create: `services/collector/src/dw_collector/desktop/__init__.py`
- Create: `services/collector/src/dw_collector/desktop/localread.py`
- Test: `services/collector/tests/test_desktop_localread.py`

- [ ] **Step 1: Write the failing test**

Create `services/collector/tests/test_desktop_localread.py`:

```python
"""Reading the local journal, which is a staging format rather than a schema.

Every target table is a JSON blob in `normalized_rows`, so these tests build
a journal by hand and assert on what comes back out.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from dw_collector.desktop import localread
from dw_collector.storage.journal import Journal


def _journal(tmp_path: Path) -> Journal:
    journal = Journal(tmp_path / "collector.db")
    journal.init_db()
    return journal


def _write_tile(
    journal: Journal,
    *,
    observation_id: str,
    captured_at: str,
    game_uid: int,
    server_id: int = 581,
    name: str | None = "ERHA",
    x: int = 100,
    y: int = 200,
    hq_level: int | None = 34,
) -> None:
    """One sighting, as the normalizer would have left it."""
    journal.conn.execute(
        "insert or ignore into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        (
            observation_id,
            "00000000-0000-4000-8000-00000000c777",
            "world.get.new",
            captured_at,
            580,
            "{}",
            captured_at,
        ),
    )
    row = {
        "row": {
            "game_uid": game_uid,
            "server_id": server_id,
            "name": name,
            "x": x,
            "y": y,
            "hq_level": hq_level,
        }
    }
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values (?, ?, ?, ?, ?)",
        (
            observation_id,
            localread.WORLD_CITY,
            f"{observation_id}-{game_uid}-{x}-{y}",
            json.dumps(row),
            captured_at,
        ),
    )
    journal.conn.commit()


def test_a_tile_comes_back_typed_with_its_capture_time(tmp_path: Path) -> None:
    # captured_at lives on raw_observations, not in row_json, so this also
    # pins that the read joins the two tables.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
    )
    found = localread.tiles(journal.conn)
    journal.close()

    assert len(found) == 1
    assert found[0].game_uid == 1190060554000581
    assert found[0].server_id == 581
    assert found[0].x == 100
    assert found[0].y == 200
    assert found[0].hq_level == 34
    assert found[0].captured_at == "2026-09-01T10:00:00+00:00"


def test_a_row_that_is_not_json_is_skipped_rather_than_crashing(
    tmp_path: Path,
) -> None:
    """A journal is written by a parser that changes. One bad row must not
    take out the whole screen."""
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-2', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-2', ?, 'bad', 'not json at all', 't')",
        (localread.WORLD_CITY,),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert len(found) == 1


def test_rows_without_a_coordinate_are_dropped_not_coerced(
    tmp_path: Path,
) -> None:
    """A pin drawn from a coerced null lands at 0,0 and looks real."""
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'world.get.new', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', ?, 'k', ?, 't')",
        (
            localread.WORLD_CITY,
            json.dumps({"row": {"game_uid": 5, "server_id": 581, "x": None, "y": 2}}),
        ),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert found == []


def test_only_world_city_rows_are_read(tmp_path: Path) -> None:
    # The journal holds seventeen target tables in one place.
    journal = _journal(tmp_path)
    journal.conn.execute(
        "insert into raw_observations "
        "(observation_id, collector_id, source_command, captured_at, "
        " collected_from_server_id, payload_json, created_at) "
        "values ('obs-1', 'c', 'player.detail', 't', 580, '{}', 't')"
    )
    journal.conn.execute(
        "insert into normalized_rows "
        "(observation_id, target_table, idempotency_key, row_json, created_at) "
        "values ('obs-1', 'player_snapshots', 'k', ?, 't')",
        (json.dumps({"row": {"game_uid": 5, "server_id": 581, "x": 1, "y": 2}}),),
    )
    journal.conn.commit()

    found = localread.tiles(journal.conn)
    journal.close()
    assert found == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `services/collector/`:

```bash
uv run pytest tests/test_desktop_localread.py -v
```

Expected: collection error, `ModuleNotFoundError: No module named 'dw_collector.desktop'`

- [ ] **Step 3: Write the minimal implementation**

Create `services/collector/src/dw_collector/desktop/__init__.py` as an empty file.

Create `services/collector/src/dw_collector/desktop/localread.py`:

```python
"""Reading the local journal the app's own collector fills.

WHY THIS IS NOT THE DASHBOARD'S QUERY LAYER. `apps/dashboard` talks to
PostgREST against typed tables and views. Nothing of that exists here: the
journal is a staging format, one JSON blob per row in `normalized_rows`
tagged by `target_table`, waiting to be synced somewhere it never goes in
this app. So every screen the desktop app grows needs its own projection,
and they all start here.

`captured_at` is deliberately taken from `raw_observations` rather than from
inside `row_json`. The observation is what has a time; the normalized row is
a derived thing that may or may not carry one, depending on the parser.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

#: The one target table this module reads so far.
WORLD_CITY = "world_city_snapshots"


@dataclass(frozen=True)
class Tile:
    """One sighting of one base."""

    game_uid: int
    server_id: int
    name: str | None
    x: int
    y: int
    hq_level: int | None
    captured_at: str


_SELECT = """
select n.row_json, r.captured_at
from normalized_rows n
join raw_observations r on r.observation_id = n.observation_id
where n.target_table = ?
"""


def tiles(conn: sqlite3.Connection) -> list[Tile]:
    """Every world-city sighting in the journal, one entry per row written."""
    found: list[Tile] = []
    for raw, captured_at in conn.execute(_SELECT, (WORLD_CITY,)).fetchall():
        try:
            row = json.loads(raw)["row"]
        except (ValueError, KeyError, TypeError):
            # A journal is written by a parser that changes over time. One
            # unreadable row must not take out the whole screen.
            continue
        x, y = row.get("x"), row.get("y")
        uid, server_id = row.get("game_uid"), row.get("server_id")
        if x is None or y is None or uid is None or server_id is None:
            # Dropped rather than coerced: a pin drawn from a null lands at
            # 0,0 and looks like a real answer.
            continue
        found.append(
            Tile(
                game_uid=int(uid),
                server_id=int(server_id),
                name=row.get("name"),
                x=int(x),
                y=int(y),
                hq_level=row.get("hq_level"),
                captured_at=captured_at,
            )
        )
    return found
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_desktop_localread.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add services/collector/src/dw_collector/desktop services/collector/tests/test_desktop_localread.py
git commit -m "feat(desktop): read world-city tiles out of the local journal"
```

---

### Task 2: One row per player, newest first

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/localread.py`
- Test: `services/collector/tests/test_desktop_localread.py`

- [ ] **Step 1: Write the failing test**

Append to `services/collector/tests/test_desktop_localread.py`:

```python
def test_one_row_per_player_at_the_newest_sighting(tmp_path: Path) -> None:
    """A sweep writes a row per tile per pan, and pans overlap.

    One base near the edge of a sweep is written once per viewport that
    caught it. Four rows for one tile reads as four findings.
    """
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-old",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        x=100,
        y=200,
    )
    _write_tile(
        journal,
        observation_id="obs-new",
        captured_at="2026-09-02T10:00:00+00:00",
        game_uid=7,
        x=140,
        y=260,
    )
    newest = localread.newest_per_player(localread.tiles(journal.conn))
    journal.close()

    assert len(newest) == 1
    # The base moved. The newest sighting is the answer, not the first one.
    assert (newest[0].x, newest[0].y) == (140, 260)


def test_the_same_uid_on_two_servers_stays_two_players(tmp_path: Path) -> None:
    # Keyed on (server_id, game_uid), matching latest_world_cities.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-a",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=580,
    )
    _write_tile(
        journal,
        observation_id="obs-b",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=7,
        server_id=581,
    )
    newest = localread.newest_per_player(localread.tiles(journal.conn))
    journal.close()
    assert len(newest) == 2
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run pytest tests/test_desktop_localread.py -v -k newest
```

Expected: FAIL with `AttributeError: module 'dw_collector.desktop.localread' has no attribute 'newest_per_player'`

- [ ] **Step 3: Write the minimal implementation**

Append to `services/collector/src/dw_collector/desktop/localread.py`:

```python
def newest_per_player(found: list[Tile]) -> list[Tile]:
    """One entry per player per server, at the newest sighting.

    The local equivalent of the `latest_world_cities` view. A sweep writes a
    row per tile per pan and pans overlap, so a single base arrives many
    times; and a base that was destroyed or lost its shield is teleported, so
    the OLDEST sighting is an address the player has left.
    """
    newest: dict[tuple[int, int], Tile] = {}
    for tile in found:
        key = (tile.server_id, tile.game_uid)
        seen = newest.get(key)
        if seen is not None and seen.captured_at >= tile.captured_at:
            continue
        newest[key] = tile
    return sorted(newest.values(), key=lambda t: t.captured_at, reverse=True)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_desktop_localread.py -v
```

Expected: 9 passed (7 from Task 1 as amended, plus the 2 added here)

- [ ] **Step 5: Commit**

```bash
git add services/collector/src/dw_collector/desktop/localread.py services/collector/tests/test_desktop_localread.py
git commit -m "feat(desktop): fold sightings to one row per player per server"
```

---

### Task 3: Search, with the limit applied after the fold

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/localread.py`
- Test: `services/collector/tests/test_desktop_localread.py`

- [ ] **Step 1: Write the failing test**

Append to `services/collector/tests/test_desktop_localread.py`:

```python
def test_a_uid_matches_whole_and_a_name_matches_loosely(tmp_path: Path) -> None:
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1190060554000581,
        name="ERHA SANGMAIMA",
    )
    by_uid = localread.search(journal.conn, "1190060554000581")
    by_name = localread.search(journal.conn, "sangmai")
    # The last six digits of a uid are the server. A substring match would
    # return every player on 581 — the opposite of narrowing.
    by_suffix = localread.search(journal.conn, "000581")
    journal.close()

    assert len(by_uid) == 1
    assert len(by_name) == 1
    assert by_suffix == []


def test_the_limit_counts_players_not_sightings(tmp_path: Path) -> None:
    """THE TRAP THIS REPO HAS ALREADY PAID FOR, one level down.

    Limiting before folding lets one heavily-swept base eat the whole
    budget, and the other players do not come back late or stale — they are
    absent. Fold first, then limit.
    """
    journal = _journal(tmp_path)
    for pan in range(5):
        _write_tile(
            journal,
            observation_id=f"obs-noisy-{pan}",
            captured_at=f"2026-09-0{pan + 1}T10:00:00+00:00",
            game_uid=1,
            name="NOISY",
        )
    _write_tile(
        journal,
        observation_id="obs-quiet",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=2,
        name="NOISY TOO",
    )
    found = localread.search(journal.conn, "noisy", limit=2)
    journal.close()

    assert {tile.game_uid for tile in found} == {1, 2}


def test_an_empty_needle_returns_nothing(tmp_path: Path) -> None:
    # Otherwise an empty box returns the entire journal.
    journal = _journal(tmp_path)
    _write_tile(
        journal,
        observation_id="obs-1",
        captured_at="2026-09-01T10:00:00+00:00",
        game_uid=1,
    )
    assert localread.search(journal.conn, "") == []
    assert localread.search(journal.conn, "   ") == []
    journal.close()
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run pytest tests/test_desktop_localread.py -v -k "search or limit or needle"
```

Expected: FAIL with `AttributeError: module 'dw_collector.desktop.localread' has no attribute 'search'`

- [ ] **Step 3: Write the minimal implementation**

Append to `services/collector/src/dw_collector/desktop/localread.py`:

```python
def search(conn: sqlite3.Connection, needle: str, *, limit: int = 25) -> list[Tile]:
    """Players matching `needle`, newest sighting first.

    THE ORDER OF OPERATIONS IS THE POINT. Folding happens before the limit,
    because limiting first lets one heavily-swept base spend the whole
    budget and the players behind it do not arrive stale — they do not
    arrive. Matching reuses `console.find.matches` so the app and the
    console agree about what a uid is.
    """
    from dw_collector.console.find import matches

    hits = [
        tile
        for tile in newest_per_player(tiles(conn))
        if matches(needle, tile.name, tile.game_uid)
    ]
    return hits[:limit]
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_desktop_localread.py -v
```

Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add services/collector/src/dw_collector/desktop/localread.py services/collector/tests/test_desktop_localread.py
git commit -m "feat(desktop): search local tiles, folding before limiting"
```

---

### Task 3b: Make `search` cheap enough to sit behind a search box

**Added during execution.** Task 3's code review quantified this from real
numbers already in the repo and it should not be lost.

`search()` calls `tiles(conn)`, which materialises **every world-city sighting
ever recorded** into a Python list and JSON-parses each one, then folds, then
filters, then slices. One pass of one server produces ~2,440 sightings
(`apps/dashboard/src/features/map/mapLocations.ts:4`), and 8,016 viewport
captures from ordinary play already produced 41,298 distinct tiles
(`docs/runbooks/season-map-capture.md:320`). A collector running continuously
across eight servers for a month is comfortably into six figures of rows.

There is **no index on `normalized_rows.target_table`** — `journal.py`'s
`_SCHEMA` declares only the `id` primary key and the unique
`idempotency_key` — so every search is a full table scan.

This is fine today because nothing calls `search()` on a keystroke. **The
trigger is Task 8**, which wires it to a live input. It must land before then.

- [ ] Add `create index if not exists normalized_rows_target_table_idx on
  normalized_rows (target_table)` to `_SCHEMA` in
  `services/collector/src/dw_collector/storage/journal.py`. Consider
  `(target_table, observation_id)` to make the join covering. **Note this
  touches the schema the production collector also writes**, so weigh the
  write cost of an extra index against the read win, and say which you chose
  and why.
- [ ] Guard `limit` in `search()`: `limit=-1` currently returns "all but the
  last match" silently. `if limit <= 0: return []`.
- [ ] Consider debouncing in the UI and caching `newest_per_player(tiles())`
  between keystrokes, since the journal only grows between refreshes. Decide
  whether that belongs here or in Task 8.

### Task 4: The sidecar's HTTP surface

**Files:**
- Create: `services/collector/src/dw_collector/desktop/sidecar.py`
- Test: `services/collector/tests/test_desktop_sidecar.py`

- [ ] **Step 1: Write the failing test**

Create `services/collector/tests/test_desktop_sidecar.py`:

```python
"""The sidecar: an HTTP surface over the local journal, and a process that
knows how to die.

Only Rust ever calls this, over loopback, so there is no CORS and no auth —
the security property comes from the port never leaving the machine.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from threading import Thread

import pytest
from dw_collector.desktop import sidecar
from dw_collector.storage.journal import Journal


@pytest.fixture
def base(tmp_path: Path) -> Iterator[str]:
    """A started sidecar on a port the OS picks, over an empty journal."""
    journal_path = tmp_path / "collector.db"
    journal = Journal(journal_path)
    journal.init_db()
    journal.close()

    httpd = sidecar.serve(journal_path, port=0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_health_says_which_journal_it_opened(base: str) -> None:
    # The window shows this. "No data" and "wrong database" look identical
    # otherwise, and the second is the one the user can fix.
    with urllib.request.urlopen(f"{base}/health") as response:
        body = json.loads(response.read())
    assert body["ok"] is True
    assert body["journal"].endswith("collector.db")


def test_find_returns_an_empty_list_for_an_empty_journal(base: str) -> None:
    with urllib.request.urlopen(f"{base}/find?q=erha") as response:
        body = json.loads(response.read())
    assert body["matches"] == []


def test_a_uid_crosses_as_a_string_so_it_cannot_round(tmp_path: Path) -> None:
    """Number.MAX_SAFE_INTEGER is sixteen digits and so is a uid.

    A uid serialized as a JSON number is one order of magnitude from
    becoming a DIFFERENT uid, which is a confident answer about the wrong
    player rather than a typo anyone would spot.
    """
    tile = sidecar.tile_json(
        game_uid=1190060554000581,
        server_id=581,
        name="ERHA",
        x=1,
        y=2,
        hq_level=34,
        captured_at="2026-09-01T10:00:00+00:00",
    )
    assert tile["gameUid"] == "1190060554000581"
    assert json.loads(json.dumps(tile))["gameUid"] == "1190060554000581"


def test_an_empty_needle_is_refused(base: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(f"{base}/find?q=%20")
    assert raised.value.code == 400
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run pytest tests/test_desktop_sidecar.py -v
```

Expected: collection error, `ModuleNotFoundError: No module named 'dw_collector.desktop.sidecar'`

- [ ] **Step 3: Write the minimal implementation**

Create `services/collector/src/dw_collector/desktop/sidecar.py`:

```python
"""The desktop app's Python half.

WHO CALLS THIS. Only the Rust side, over loopback, on a port the OS picks and
this process announces on stdout. The webview never speaks to it directly,
which is why there is no CORS handling here and no authentication: the
security property is that the port is never published, not that callers are
checked.

Stdlib http.server rather than a framework, for the reason the console is
Tkinter — a shipped tool that needs its own install is one more thing to be
broken on somebody else's machine.
"""

from __future__ import annotations

import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from dw_collector.desktop import localread

HOST = "127.0.0.1"


def tile_json(
    *,
    game_uid: int,
    server_id: int,
    name: str | None,
    x: int,
    y: int,
    hq_level: int | None,
    captured_at: str,
) -> dict[str, Any]:
    """One tile as the window reads it.

    THE UID IS A STRING, always. See the test for why.
    """
    return {
        "gameUid": str(game_uid),
        "serverId": server_id,
        "name": name,
        "x": x,
        "y": y,
        "hqLevel": hq_level,
        "capturedAt": captured_at,
    }


class Handler(BaseHTTPRequestHandler):
    """GET /health and GET /find?q=<uid or name>."""

    protocol_version = "HTTP/1.1"
    server_version = "dw-sidecar"

    #: Set by `serve`. The journal this process was pointed at.
    journal_path: Path = Path()

    def log_message(self, format: str, *args: Any) -> None:
        """Silence. A search names a player being hunted; that belongs in no
        log file, least of all one shipped to somebody else's machine."""

    def _send(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            # Naming the journal makes "no data yet" distinguishable from
            # "pointed at the wrong file", and only the second is fixable.
            self._send(200, {"ok": True, "journal": str(self.journal_path)})
            return
        if parsed.path != "/find":
            self._send(404, {"error": "no such endpoint"})
            return

        needle = (parse_qs(parsed.query).get("q") or [""])[0].strip()
        if not needle:
            self._send(400, {"error": "no uid or name given"})
            return

        conn = sqlite3.connect(self.journal_path)
        try:
            found = localread.search(conn, needle)
        finally:
            conn.close()
        self._send(
            200,
            {
                "matches": [
                    tile_json(
                        game_uid=tile.game_uid,
                        server_id=tile.server_id,
                        name=tile.name,
                        x=tile.x,
                        y=tile.y,
                        hq_level=tile.hq_level,
                        captured_at=tile.captured_at,
                    )
                    for tile in found
                ]
            },
        )


def serve(journal_path: Path, *, port: int = 0) -> ThreadingHTTPServer:
    """A started server. The caller owns `serve_forever` and shutdown."""
    handler = type("BoundHandler", (Handler,), {"journal_path": journal_path})
    return ThreadingHTTPServer((HOST, port), handler)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_desktop_sidecar.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add services/collector/src/dw_collector/desktop/sidecar.py services/collector/tests/test_desktop_sidecar.py
git commit -m "feat(desktop): serve the local journal over loopback"
```

---

### Task 5: The sidecar dies when its parent does

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/sidecar.py`
- Modify: `services/collector/pyproject.toml:27` (add `dw-sidecar` entrypoint)
- Test: `services/collector/tests/test_desktop_sidecar.py`

This is the task that makes the orphan impossible. Rust killing the child
handles the ordinary case; this handles Rust panicking, being killed from Task
Manager, or otherwise never getting to run its cleanup. When the parent dies
the pipe closes, stdin reaches EOF, and this process shuts itself down.

- [ ] **Step 1: Write the failing test**

First add these three to the import block at the TOP of
`services/collector/tests/test_desktop_sidecar.py`, keeping it sorted — ruff's
`I001` fails the gate on imports left in the middle of a file:

```python
import subprocess
import sys
import time
```

Then append to the same file:

```python
def test_closing_stdin_stops_the_process(tmp_path: Path) -> None:
    """THE ORPHAN GUARD.

    If Rust dies without cleaning up, the only thing left telling this
    process anything is its own stdin reaching EOF. A sidecar that ignores
    that keeps capturing packets with no window attached — the same shape as
    the phantom scheduled task this repo has already chased.
    """
    journal_path = tmp_path / "collector.db"
    Journal(journal_path).init_db()

    child = subprocess.Popen(
        [sys.executable, "-m", "dw_collector.desktop.sidecar", str(journal_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    announced = child.stdout.readline().strip()
    assert announced.startswith("PORT ")

    assert child.stdin is not None
    child.stdin.close()

    # Generous, because process teardown on Windows is not instant.
    for _ in range(50):
        if child.poll() is not None:
            break
        time.sleep(0.1)
    assert child.poll() is not None, "sidecar outlived its parent's stdin"


def test_the_port_is_announced_on_the_first_line(tmp_path: Path) -> None:
    """Rust reads exactly one line to learn where to connect, so nothing may
    be printed before it."""
    journal_path = tmp_path / "collector.db"
    Journal(journal_path).init_db()

    child = subprocess.Popen(
        [sys.executable, "-m", "dw_collector.desktop.sidecar", str(journal_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    port = int(child.stdout.readline().strip().removeprefix("PORT "))
    assert 1024 < port < 65536

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health") as response:
        assert json.loads(response.read())["ok"] is True

    assert child.stdin is not None
    child.stdin.close()
    child.wait(timeout=10)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
uv run pytest tests/test_desktop_sidecar.py -v -k "stdin or announced or first_line"
```

Expected: FAIL with `AssertionError: assert ''.startswith('PORT ')`.

`python -m dw_collector.desktop.sidecar` runs the module as `__main__`. Right
now it only defines things and exits 0 without printing, so `readline()`
returns the empty string. That is the correct failure — if you instead see
`ModuleNotFoundError`, Task 4 was not committed.

- [ ] **Step 3: Write the minimal implementation**

Append to `services/collector/src/dw_collector/desktop/sidecar.py`:

```python
def _stop_when_stdin_closes(httpd: ThreadingHTTPServer) -> None:
    """Shut down once the parent's pipe reaches EOF.

    Rust kills this process on a clean exit. This is the other half: if Rust
    panics or is killed from Task Manager it never gets to, and the only
    remaining signal is stdin closing. Without this the window disappears and
    a Python process keeps holding the journal open.
    """
    try:
        while sys.stdin.readline():
            pass
    except (OSError, ValueError):
        pass
    httpd.shutdown()


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    journal_path = Path(args[0]) if args else Path(
        os.environ.get("DW_SQLITE_PATH", "./data/collector.db")
    )

    httpd = serve(journal_path, port=0)
    # FIRST LINE, NOTHING BEFORE IT. Rust reads exactly one line to learn the
    # port, so any earlier print would be read as the port and fail.
    print(f"PORT {httpd.server_address[1]}", flush=True)

    threading.Thread(target=_stop_when_stdin_closes, args=(httpd,), daemon=True).start()
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Add to the imports at the top of the same file, keeping them sorted:

```python
import os
import sys
import threading
```

Create `services/collector/src/dw_collector/desktop/__main__.py`:

```python
"""`python -m dw_collector.desktop.sidecar` needs a module entrypoint, and so
does the PyInstaller build."""

from dw_collector.desktop.sidecar import main

if __name__ == "__main__":
    raise SystemExit(main())
```

Add the console entrypoint to `services/collector/pyproject.toml`, after the
`dw-notify` line:

```toml
# The desktop app's Python half. Packaged by PyInstaller, started and stopped
# by the Tauri window — never run by a person.
dw-sidecar = "dw_collector.desktop.sidecar:main"
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
uv run pytest tests/test_desktop_sidecar.py -v
```

Expected: 6 passed

- [ ] **Step 5: Run the whole Python gate**

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```

Expected: all pass. Fix anything ruff flags before committing — this repo
treats the local gate as the only gate.

- [ ] **Step 6: Commit**

```bash
git add services/collector/src/dw_collector/desktop services/collector/tests/test_desktop_sidecar.py services/collector/pyproject.toml
git commit -m "feat(desktop): stop the sidecar when its parent's stdin closes"
```

---

### Task 6: Package the sidecar with PyInstaller

**Files:**
- Modify: `services/collector/pyproject.toml` (add PyInstaller to the dev group)
- Create: `services/collector/dw-sidecar.spec`

- [ ] **Step 1: Add the build dependency**

In `services/collector/pyproject.toml`, add to `[dependency-groups] dev`:

```toml
    "pyinstaller>=6.11",
```

- [ ] **Step 2: Write the spec file**

Create `services/collector/dw-sidecar.spec`:

```python
# PyInstaller spec for the desktop app's Python half.
#
# One file rather than one folder: Tauri's externalBin wants a single
# executable to copy, and the sidecar is small enough that the unpack cost on
# start is not noticeable next to opening a window.
#
# NOT the collector. This packages only the read path — no scapy, no capture.
# Bundling capture here would double the binary and drag Npcap's import into a
# process that never touches a network interface.

a = Analysis(
    ["src/dw_collector/desktop/__main__.py"],
    pathex=["src"],
    binaries=[],
    datas=[],
    # PyInstaller cannot see imports made inside a function, and
    # `localread.search` imports `console.find` lazily.
    hiddenimports=["dw_collector.desktop.sidecar", "dw_collector.console.find"],
    excludes=["scapy", "tkinter", "httpx", "typer"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    # console=True on purpose: the port announcement goes to stdout and the
    # parent reads it. A windowed build has no stdout to read.
    console=True,
    name="dw-sidecar",
    upx=False,
)
```

- [ ] **Step 3: Build it**

Run from `services/collector/`:

```bash
uv run pyinstaller dw-sidecar.spec --noconfirm
```

Expected: `dist/dw-sidecar.exe` exists.

- [ ] **Step 4: Verify the packaged binary behaves like the module**

```bash
./dist/dw-sidecar.exe ./data/collector.db
```

Expected: prints one line `PORT <number>` and stays running. Press Ctrl+C to
stop. If it exits immediately, a `hiddenimports` entry is missing — PyInstaller
cannot see imports made inside functions, and `localread.search` imports
`console.find` lazily.

- [ ] **Step 5: Ignore the build output**

Add to `.gitignore`:

```
services/collector/build/
services/collector/dist/
```

- [ ] **Step 6: Commit**

```bash
git add services/collector/pyproject.toml services/collector/dw-sidecar.spec services/collector/uv.lock .gitignore
git commit -m "build(desktop): package the sidecar as a single executable"
```

---

### Task 7: The Tauri window, with no sidecar yet

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/src/main.rs`

Getting a window on screen before wiring the sidecar means a failure in the
next task has exactly one possible cause.

- [ ] **Step 1: Create the workspace member**

`apps/desktop/package.json`:

```json
{
  "name": "@dw/desktop",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "tauri": "tauri",
    "app": "tauri dev",
    "test": "echo \"no vitest suite yet\" && exit 0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

The `test` script exists because the root runs `pnpm -r test`; a member
without one fails the whole run.

- [ ] **Step 2: Create the frontend**

`apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Dark War</title>
  </head>
  <body>
    <main>
      <h1>Dark War</h1>
      <p id="status">starting…</p>
      <input id="needle" placeholder="UID, or part of a name" />
      <button id="go" type="button">Find</button>
      <pre id="out"></pre>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/desktop/src/main.ts`:

```ts
// Spike UI. Deliberately not React: this task proves a window opens, and a
// framework here would add a second thing that could be broken.
const status = document.querySelector<HTMLParagraphElement>('#status');
if (status !== null) {
  status.textContent = 'window is up';
}
```

`apps/desktop/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

// Fixed port: tauri.conf.json names the same one, and Tauri will not go
// looking for a dev server on a port it was not told about.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
```

`apps/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the Rust side**

`apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "dw-desktop"
version = "0.0.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde_json = "1"
reqwest = { version = "0.12", default-features = false, features = ["json"] }
tokio = { version = "1", features = ["rt-multi-thread"] }
```

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Dark War",
  "version": "0.0.0",
  "identifier": "us.cbfw.darkwar.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [{ "title": "Dark War", "width": 1100, "height": 750 }],
    "security": { "csp": null }
  },
  "bundle": { "active": true, "targets": ["nsis"] }
}
```

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start the Dark War window");
}
```

- [ ] **Step 4: Install and run**

Run from `apps/desktop/`:

```bash
pnpm install
pnpm app
```

Expected: first run compiles Rust dependencies, which takes several minutes.
A window titled "Dark War" opens showing the heading and "window is up".

- [ ] **Step 5: Verify the repo gate still passes**

Run from the repo root:

```bash
pnpm check && pnpm typecheck && pnpm test
```

Expected: all pass. `apps/desktop/src-tauri/target/` must not be walked —
if biome or tsc picks it up, add it to `.gitignore` and to biome's ignore list.

- [ ] **Step 6: Ignore Rust build output and commit**

Add to `.gitignore`:

```
apps/desktop/src-tauri/target/
apps/desktop/dist/
```

```bash
git add apps/desktop .gitignore pnpm-lock.yaml
git commit -m "feat(desktop): open a Tauri window"
```

---

### Task 8: Rust starts the sidecar and proxies the search

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src/main.ts`

Rust proxies rather than letting the webview call the port directly. That keeps
the port unpublished, and means no CORS configuration exists to get wrong.

- [ ] **Step 1: Copy the packaged sidecar into place**

Tauri's `externalBin` expects the target triple in the filename. From
`apps/desktop/`:

```bash
mkdir -p src-tauri/binaries
cp ../../services/collector/dist/dw-sidecar.exe src-tauri/binaries/dw-sidecar-x86_64-pc-windows-msvc.exe
```

Add to `.gitignore`:

```
apps/desktop/src-tauri/binaries/
```

- [ ] **Step 2: Declare it in the bundle**

In `apps/desktop/src-tauri/tauri.conf.json`, replace the `bundle` block:

```json
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "externalBin": ["binaries/dw-sidecar"]
  }
```

- [ ] **Step 3: Spawn it and expose a command**

Replace `apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

/// The sidecar, and where it is listening.
///
/// The child is held so it can be killed on exit. Its stdin is held too, and
/// deliberately never written to: keeping the pipe open is what tells the
/// sidecar we are still alive, and dropping it is what tells it we are not.
struct Sidecar {
    child: Mutex<Option<Child>>,
    port: u16,
}

/// Windows: do not give the child a console window of its own.
///
/// The sidecar is built with `console=True` because it announces its port on
/// stdout and we have to read it. Without this flag, a GUI process spawning a
/// console process pops a black window next to ours on every start.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn start(exe: std::path::PathBuf, journal: std::path::PathBuf) -> Sidecar {
    let mut command = Command::new(exe);
    command
        .arg(journal)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().expect("could not start the sidecar");

    let stdout = child.stdout.take().expect("sidecar has no stdout");
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .expect("sidecar announced no port");
    let port: u16 = line
        .trim()
        .strip_prefix("PORT ")
        .expect("first line was not a port announcement")
        .parse()
        .expect("port was not a number");

    Sidecar { child: Mutex::new(Some(child)), port }
}

#[tauri::command]
async fn find(
    state: tauri::State<'_, Sidecar>,
    needle: String,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "http://127.0.0.1:{}/find?q={}",
        state.port,
        urlencoding_minimal(&needle)
    );
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

/// Percent-encode the few characters a uid or in-game name can contain that
/// would otherwise change the query string. Names carry spaces and emoji.
fn urlencoding_minimal(raw: &str) -> String {
    raw.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{:02X}", other),
        })
        .collect()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let exe = app
                .path()
                .resolve("dw-sidecar.exe", tauri::path::BaseDirectory::Resource)
                .expect("sidecar was not bundled");
            let journal = app
                .path()
                .app_data_dir()
                .expect("no app data directory")
                .join("collector.db");
            app.manage(start(exe, journal));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![find])
        .run(tauri::generate_context!())
        .expect("failed to start the Dark War window");
}
```

- [ ] **Step 4: Call it from the window**

Replace `apps/desktop/src/main.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

interface Tile {
  gameUid: string;
  serverId: number;
  name: string | null;
  x: number;
  y: number;
  hqLevel: number | null;
  capturedAt: string;
}

const status = document.querySelector<HTMLParagraphElement>('#status');
const needle = document.querySelector<HTMLInputElement>('#needle');
const go = document.querySelector<HTMLButtonElement>('#go');
const out = document.querySelector<HTMLPreElement>('#out');

if (status !== null) {
  status.textContent = 'window is up';
}

go?.addEventListener('click', async () => {
  const typed = needle?.value.trim() ?? '';
  if (typed === '' || out === null) {
    return;
  }
  out.textContent = 'reading…';
  try {
    const answer = await invoke<{ matches: Tile[] }>('find', { needle: typed });
    out.textContent =
      answer.matches.length === 0
        ? `nothing matching ${typed}`
        : answer.matches
            .map((t) => `${t.name ?? 'unnamed'} at ${t.x}, ${t.y} — uid ${t.gameUid}`)
            .join('\n');
  } catch (error) {
    out.textContent = `could not search: ${String(error)}`;
  }
});
```

Add the API package. From `apps/desktop/`:

```bash
pnpm add @tauri-apps/api
```

- [ ] **Step 5: Run it against a real journal**

Copy a journal into the app data directory the Rust side reads
(`%APPDATA%\us.cbfw.darkwar.desktop\collector.db`), then:

```bash
pnpm app
```

Expected: type a uid you know is in that journal, press Find, and see a line
naming its coordinates. An empty journal shows `nothing matching <uid>`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop .gitignore pnpm-lock.yaml
git commit -m "feat(desktop): search the local journal from the window"
```

---

### Task 9: Prove nothing survives the window

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Create: `docs/runbooks/desktop-sidecar-lifecycle.md`

This is the task ADR 0001 phase 0 exists for. If it cannot be made to pass,
the Tauri decision is the thing to revisit, not the test.

- [ ] **Step 1: Kill the child on exit**

In `apps/desktop/src-tauri/src/main.rs`, replace the `tauri::Builder::default()`
chain in `main` with one that also handles exit:

```rust
    tauri::Builder::default()
        .setup(|app| {
            let exe = app
                .path()
                .resolve("dw-sidecar.exe", tauri::path::BaseDirectory::Resource)
                .expect("sidecar was not bundled");
            let journal = app
                .path()
                .app_data_dir()
                .expect("no app data directory")
                .join("collector.db");
            app.manage(start(exe, journal));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![find])
        .build(tauri::generate_context!())
        .expect("failed to start the Dark War window")
        .run(|app, event| {
            // The ordinary path. The stdin guard in the sidecar covers the
            // paths this never reaches — a panic here, or being killed from
            // Task Manager.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut held) = state.child.lock() {
                        if let Some(mut child) = held.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
```

- [ ] **Step 2: Run the three-way exit test by hand**

There is no automated test here — it is about OS process teardown, which
cannot be asserted from inside the process being torn down. Run all three and
record the result.

For each: start with `pnpm app`, confirm a search works, then end the app the
stated way, then check for survivors:

```bash
tasklist | grep -i dw-sidecar
```

Expected after every one: no output.

1. **Normal close.** Click the window's X.
2. **Force quit.** End `dw-desktop.exe` from Task Manager — the parent only,
   not the tree. This is the case the Rust cleanup never runs for; the stdin
   guard from Task 5 is what has to catch it.
3. **Rust panic.** Temporarily add `panic!("lifecycle test")` as the first line
   of the `find` command, run a search, then remove it. The window dies mid-
   call and the sidecar must still go.

- [ ] **Step 3: Write the result down**

Create `docs/runbooks/desktop-sidecar-lifecycle.md`:

```markdown
# The desktop sidecar's lifetime

The app is two processes. The window is Rust; the reader is Python. The
failure that matters is the window going away while Python keeps running,
because that process holds the journal open and, once capture is wired in,
would still be capturing with nothing on screen. This repo has already chased
one phantom process — a scheduled task reporting Running with nothing behind
it — and this is the same shape.

Two mechanisms, because one is not enough:

- **Rust kills the child** on `ExitRequested`. Covers the ordinary close.
- **The sidecar stops when its stdin reaches EOF.** Covers everything Rust
  never gets to run for: a panic, or being killed from Task Manager. Rust
  holds the pipe open and never writes to it; the pipe closing IS the signal.

## Verifying after any change to either side

Start with `pnpm app` from `apps/desktop/`, confirm a search returns, then end
the app three ways. After each, `tasklist | grep -i dw-sidecar` must print
nothing.

1. Close the window normally.
2. End `dw-desktop.exe` from Task Manager — the parent alone, not the tree.
3. Put `panic!("lifecycle test")` at the top of the `find` command, search,
   then remove it.

Case 2 is the one that regresses silently: it still passes if the stdin guard
is removed *and* you only ever test case 1.

## Last run

<!-- Date, and the result of each of the three cases. -->
```

Fill in the "Last run" section with today's date and the three results.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/main.rs docs/runbooks/desktop-sidecar-lifecycle.md
git commit -m "feat(desktop): kill the sidecar with the window, and prove it"
```

---

## Done when

- `uv run pytest` passes in `services/collector/`, including 9 localread and
  6 sidecar tests.
- `pnpm check && pnpm typecheck && pnpm test && pnpm build` passes at the root.
- `pnpm app` opens a window that answers a search from a real local journal.
- All three exit cases leave no `dw-sidecar` process, recorded in the runbook.

### Task 8b: Fail visibly at startup

**Added during execution**, from Task 8's review. Both of these make the app
fail *silently* for someone who cannot read a stack trace, which is the whole
audience.

- [ ] **The port wait can hang the app with no UI at all.** `start()` does a
  blocking `read_line` with no timeout, inside `.setup()`, on the main
  thread — so if the sidecar starts but never prints (wrong exe, a
  PyInstaller unpack stall, antivirus holding the binary), the event loop is
  never reached and **no window ever paints**. Not a frozen window: nothing.
  Fix by showing the window first — it already renders `#status` — then
  spawning the sidecar and its blocking read on a background thread, and
  updating the UI when the port arrives or fails. If a synchronous wait is
  kept instead, bound it (read on a thread, `recv_timeout` on a channel).
- [ ] **`.expect()` panics are invisible in release.** `windows_subsystem =
  "windows"` means no console, so a missing `dw-sidecar.exe` panics to a
  stderr that goes nowhere and the process just vanishes. Convert those to
  `Result`s surfaced in the window itself (which the fix above makes
  possible), or install a `std::panic::set_hook` showing a native message
  box before any of it runs.

## Carried forward, found during execution

Raised by Task 7's review. None blocks this plan; all must be closed before
anything is handed to another player.

- **The icon is a placeholder and is not even wired to the bundler.** A
  32×32 solid-colour `icon.ico` exists only to satisfy `tauri-build`'s
  Windows resource step. `tauri.conf.json`'s `bundle` has no `icon` key at
  all, so a real `tauri build` ships a generic icon regardless. Run
  `tauri icon <source>` and add `"icon": [...]` in Phase 6.
- **`"security": { "csp": null }` disables CSP entirely.** It is Tauri's
  scaffold default and is survivable while the window renders nothing, but
  Task 8 starts rendering player names out of the journal, and a player
  chooses their own in-game name. Two consequences: **every journal-derived
  string reaches the DOM through `textContent`, never `innerHTML`**, and an
  explicit policy (`default-src 'self'`) replaces `null` before Phase 6
  distribution.
- **`@dw/desktop`'s `test` script is `echo … && exit 0`.** Every other
  workspace member runs a real `vitest`. An always-green entry inside
  `pnpm -r test` is invisible, and this repo's local gate is the only gate
  there is. Replace it with a real smoke test no later than Phase 4.

## What this deliberately does not do

- No capture. The app reads a journal something else filled; wiring capture in
  is Phase 3, and it depends on the settings screen existing.
- No map drawing. Results are text. Phase 4 extracts `MapCanvas` into
  `packages/ui` and both dashboards consume it.
- No settings. The journal path is hardcoded to the app data directory.
- No installer beyond whatever `tauri build` emits by default.
