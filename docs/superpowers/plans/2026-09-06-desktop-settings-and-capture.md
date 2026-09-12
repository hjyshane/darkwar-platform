# Desktop App: Settings and Capture Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player installs the app, picks their network adapter from a list, presses Start, and their own journal begins filling — with no `.env` file, no PowerShell script, and no scheduled task.

**Architecture:** The settings live in one JSON file in the app's data directory, and the environment still wins over it so the existing collector and CI are untouched. The sidecar gains a settings surface and a capture supervisor that spawns `dumpcap.exe` directly as a child process and runs the existing pure-Python ingest loop against the files it drops.

**Tech Stack:** Python 3.12 (stdlib only), `dumpcap.exe` from Npcap/Wireshark, Rust + Tauri v2, TypeScript, pytest.

---

## Scope

ADR 0001 phase 3. Ends with an app that can configure and run its own capture.

**Not in this plan:** map rendering and `packages/ui` (phase 4), the remaining screens (phase 5), installer and signing (phase 6).

## Two decisions this plan makes, and why

**One: the app spawns `dumpcap` itself, rather than registering a scheduled task.**

Today `dw-console` does not start capture at all — it runs `schtasks /run /tn DarkWar-Capture`, and that task was registered ahead of time by `register-tasks.ps1`, which is also the only place `dumpcap`'s ring arguments and its hardcoded path live. That arrangement is right for a machine that collects around the clock: capture survives the console being closed.

It is wrong for something handed to another player. Registering a scheduled task needs elevation, leaves state behind after an uninstall, and turns "run this PowerShell script first" into step one of the setup — which is the exact thing this phase exists to delete.

So capture becomes a child of the app and stops when the app stops. That is a real behaviour change and it should be said on screen. It is also the cheaper correctness story: the process-lifetime work is already done and proven, and a child dies with its parent through machinery that already exists.

**Two: the dumpcap ring, not the scapy sniffer.**

There are two capture paths in this repo. `dw-capture` sniffs live through scapy; the other has `dumpcap.exe` write rotating `.pcapng` files that `cli.py`'s `ingest-dir` then reads. The sidecar's PyInstaller build excludes scapy deliberately, and `protocol/pcapng.py` opens with "Pure stdlib (no scapy)" — verified through `frames.py` and `sfs.py`, neither of which imports it either.

So the ring path runs in the packaged app as-is and the scapy path cannot. That settles it, and it also means the parser the app uses is the same one the continuous pipeline uses — no second decoder.

## What I can verify, and what only you can

Most of this is fixture-testable and will be tested. These steps are **not**, and ship verified by the person running it on a real machine:

- That `dumpcap` actually captures game traffic on port 8680. Needs Npcap, BlueStacks, and the game connected.
- That the adapter a player picks is the right one. Nothing in this repo validates the choice, and a wrong adapter fails **silently** — `register-tasks.ps1:78-82` already warns about exactly this.
- Ring rotation and the `min-age` race under real load.
- Npcap's install states: missing driver, permission prompts, WinPcap conflicts.
- Adapters with non-ASCII names, which `capture/live.py:79-89` records as a real past incident.

Each of those has a manual step in the task that introduces it. Do not mark those tasks done on a green test run alone.

## Background the engineer needs

**The ring invocation, quoted from `register-tasks.ps1:250`** — the app must produce the same shape:

```
dumpcap.exe -i "<iface>" -f "tcp port 8680" -w "<dir>\cap.pcapng" -b duration:15 -b files:5760 -B 64
```

`<iface>` is an **NPF device name** (`\Device\NPF_{GUID}`), not a friendly name. It is found with `dumpcap -D`, which nothing in this repo currently runs — `register-tasks.ps1:16` only mentions it in a comment for a human.

**Ingest is a CLI command, not an env-configured daemon.** `cli.py:755`'s `ingest-dir` polls a directory, skips files still being written, parses each closed one, and records its name in `ingested_captures` so it is never read twice. Its interval, min-age, port and server id are **command flags**, not `DW_*` variables.

**`DW_COLLECTOR_ID` is not a credential.** Locally it is a plain `text` column with no foreign key (`journal.py:20-28`); its only job is to be one of five components hashed into the unique `idempotency_key` (`models.py:84-99`). It has to be a valid UUID and it has to stay the same across restarts. `cli.py:624` currently falls back to a shared placeholder, which is why a generated one is better: every install having its own keeps the dedup history meaningful.

**Environment wins over the settings file.** `envfile.py` already establishes the precedent with `os.environ.setdefault`, and the reason matters — the existing collector, CI, and `uv run --env-file` must keep working exactly as they do. A settings file that overrode the environment would silently change the behaviour of the machine this repo is developed on.

## File Structure

**Python — `services/collector/src/dw_collector/desktop/`**

| File | Responsibility |
|---|---|
| `settings.py` | The config model, its file, and precedence. No subprocesses. |
| `adapters.py` | `dumpcap` discovery, `-D` parsing, Npcap presence. No config. |
| `capture.py` | Spawning and stopping dumpcap and the ingest loop. No HTTP. |
| `sidecar.py` | Gains settings, adapter and capture endpoints. Still no SQL. |

The split is the same discipline as `localread`/`sidecar`: everything that can be tested without a server or a subprocess is kept where it can be.

**Tauri — `apps/desktop/`**

| File | Responsibility |
|---|---|
| `src-tauri/src/main.rs` | Gains commands proxying the new endpoints. |
| `src/settings.ts` | The settings screen. |
| `src/main.ts` | Routes between search and settings. |

---

### Task 1: The settings file, and what wins

**Files:**
- Create: `services/collector/src/dw_collector/desktop/settings.py`
- Test: `services/collector/tests/test_desktop_settings.py`

- [ ] **Step 1: Write the failing tests**

Create `services/collector/tests/test_desktop_settings.py`:

```python
"""The settings a player edits instead of a .env file.

THE ENVIRONMENT STILL WINS, and that is not a detail. This repo is developed
on a machine whose collector is configured entirely by environment variables
and a .env at the repo root; a settings file that overrode them would change
what that machine does the first time somebody opens the app on it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from dw_collector.desktop import settings


def test_defaults_stand_in_for_a_file_that_does_not_exist_yet(
    tmp_path: Path,
) -> None:
    # First run. Nothing should explode, and nothing should be written just
    # by asking what the settings are.
    loaded = settings.load(tmp_path / "settings.json", environ={})
    assert loaded.game_port == 8680
    assert loaded.server_id == 580
    assert not (tmp_path / "settings.json").exists()


def test_a_saved_file_is_read_back(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    settings.save(path, settings.Settings(server_id=581, capture_dir="C:/caps"))
    loaded = settings.load(path, environ={})
    assert loaded.server_id == 581
    assert loaded.capture_dir == "C:/caps"


def test_the_environment_beats_the_file(tmp_path: Path) -> None:
    """The machine this repo is developed on is configured by environment,
    and opening the app on it must not quietly reconfigure the collector."""
    path = tmp_path / "settings.json"
    settings.save(path, settings.Settings(server_id=581, capture_dir="C:/from-file"))
    loaded = settings.load(
        path,
        environ={"DW_COLLECTOR_SERVER_ID": "584", "DW_CAPTURE_DIR": "C:/from-env"},
    )
    assert loaded.server_id == 584
    assert loaded.capture_dir == "C:/from-env"


def test_a_collector_id_is_generated_once_and_then_kept(tmp_path: Path) -> None:
    """It is not a credential — it is one of five components hashed into the
    unique idempotency key, so it only has to be a UUID and it only has to
    stop changing. A new one every launch would re-key the dedup history."""
    path = tmp_path / "settings.json"
    first = settings.ensure_collector_id(path)
    second = settings.ensure_collector_id(path)
    assert first == second
    assert len(first) == 36
    # And it was actually persisted, not just returned.
    assert json.loads(path.read_text(encoding="utf-8"))["collector_id"] == first


def test_a_corrupt_file_falls_back_rather_than_refusing_to_start(
    tmp_path: Path,
) -> None:
    """A settings file nobody can parse must not be the reason the app will
    not open — the screen that fixes it is inside the app."""
    path = tmp_path / "settings.json"
    path.write_text("{ this is not json", encoding="utf-8")
    loaded = settings.load(path, environ={})
    assert loaded.game_port == 8680


def test_an_unknown_key_in_the_file_is_ignored(tmp_path: Path) -> None:
    # A file written by a later version must not stop an earlier one.
    path = tmp_path / "settings.json"
    path.write_text(
        json.dumps({"server_id": 581, "invented_later": True}), encoding="utf-8"
    )
    assert settings.load(path, environ={}).server_id == 581
```

- [ ] **Step 2: Run to verify it fails**

From `services/collector/`:
```bash
uv run pytest tests/test_desktop_settings.py -v
```
Expected: `ModuleNotFoundError: No module named 'dw_collector.desktop.settings'`

- [ ] **Step 3: Implement**

Create `services/collector/src/dw_collector/desktop/settings.py`. A frozen dataclass `Settings` with fields `journal_path: str`, `capture_dir: str`, `interface: str`, `dumpcap_path: str`, `server_id: int = 580`, `game_port: int = 8680`, `collector_id: str = ""` — all with defaults so a missing file is not an error.

`load(path, *, environ)` reads the JSON if it parses, ignores keys it does not know, then lets these environment variables override, matching what the existing code reads: `DW_SQLITE_PATH`, `DW_CAPTURE_DIR`, `DW_CAPTURE_NPF_DEVICE`, `DW_COLLECTOR_SERVER_ID`, `DW_COLLECTOR_ID`. `save(path, value)` writes it, creating parent directories. `ensure_collector_id(path)` returns the stored id or generates, persists and returns a new `uuid4`.

Take `environ` as a parameter rather than reading `os.environ` inside — a test that mutates the real environment leaks into every test after it.

Module docstring must explain WHY the environment wins, in the house voice.

- [ ] **Step 4: Verify**

```bash
uv run pytest tests/test_desktop_settings.py -v
```
Expected: 6 passed

- [ ] **Step 5: Gate and commit**

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```
(`test_pgtap_plans.py::...[90_season_lab_score_test.sql]` may fail for an unrelated pre-existing reason — ignore only that one.)

```bash
git add services/collector/src/dw_collector/desktop/settings.py services/collector/tests/test_desktop_settings.py
git commit -m "feat(desktop): settings a player edits, with the environment still winning"
```

---

### Task 2: Finding dumpcap, and listing adapters

**Files:**
- Create: `services/collector/src/dw_collector/desktop/adapters.py`
- Test: `services/collector/tests/test_desktop_adapters.py`

This is the task that makes the settings screen possible: without a list, a player would have to type `\Device\NPF_{GUID}` by hand.

- [ ] **Step 1: Capture a real `dumpcap -D` fixture**

On this machine, run:
```bash
"C:\Program Files\Wireshark\dumpcap.exe" -D
```
Paste the real output into the test as a fixture string. If Wireshark is not installed here, use this shape, which is what `dumpcap -D` emits, and say in your report that the fixture is synthetic:

```
1. \Device\NPF_{2C4A1B3D-9E8F-4A1B-8C7D-1E2F3A4B5C6D} (Ethernet)
2. \Device\NPF_{7F6E5D4C-3B2A-1908-7654-321FEDCBA098} (VirtualBox Host-Only Network)
3. \Device\NPF_Loopback (Adapter for loopback traffic capture)
```

- [ ] **Step 2: Write the failing tests**

Create `services/collector/tests/test_desktop_adapters.py` with tests for:

1. `parse_interfaces` turns that output into a list of `(device, label)` pairs, device being the `\Device\NPF_...` part and label the parenthesised description.
2. A line it cannot parse is skipped, not crashed on — `dumpcap`'s output format is not a contract.
3. **A non-ASCII label survives.** `capture/live.py:79-89` records a real incident with localized adapter names. Include a line with a Korean adapter name in the fixture and assert it round-trips.
4. Empty output produces an empty list rather than an error — that is what "Npcap is not installed" looks like.
5. `find_dumpcap` returns the first path that exists from a candidate list, and `None` when none do.

Write the actual test code with real assertions, following the style of `test_desktop_localread.py`.

- [ ] **Step 3: Run to verify it fails, then implement**

`adapters.py` provides:
- `DUMPCAP_CANDIDATES` — the hardcoded path from `register-tasks.ps1:32` plus the x86 Program Files variant, with a comment noting the original is the only one this repo has ever used.
- `find_dumpcap(candidates=DUMPCAP_CANDIDATES, which=shutil.which) -> str | None` — candidates first, then `PATH`.
- `parse_interfaces(raw: str) -> list[tuple[str, str]]` — pure, no subprocess.
- `list_interfaces(dumpcap: str, *, run=subprocess.run) -> list[tuple[str, str]]` — runs `dumpcap -D` and parses. Inject `run` so it is testable without Npcap.
- `npcap_state(dumpcap: str | None) -> str` — one of `"ready"`, `"no-dumpcap"`, `"no-adapters"`. Nothing in this repo checks for Npcap today; this is the first thing that does.

Every subprocess call must set `CREATE_NO_WINDOW` on Windows, for the same reason the sidecar spawn does — a GUI app must not flash console windows.

- [ ] **Step 4: Verify, gate, commit**

Expected: 5 or more passed. Same gate as Task 1.

```bash
git commit -m "feat(desktop): find dumpcap and list the adapters it can see"
```

- [ ] **Step 5: MANUAL — confirm against the real machine**

Run the real `dumpcap -D` on this machine and confirm `parse_interfaces` handles its actual output, including any adapter with a non-ASCII name. **Report the real device strings.** This is the first of the steps that a green test run does not cover.

---

### Task 3: Settings and adapters over the sidecar

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/sidecar.py`
- Test: `services/collector/tests/test_desktop_sidecar.py`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- `GET /settings` returns the current settings as JSON, with `collectorId` as a string.
- `PUT /settings` accepts a JSON body, writes it, and a following `GET` returns it.
- `PUT /settings` with a malformed body returns 400 with a message, not a dropped connection — the same standard `/find` already meets.
- `GET /adapters` returns `{"state": "...", "adapters": [{"device": ..., "label": ...}]}`.
- `GET /adapters` when `dumpcap` is missing returns `state: "no-dumpcap"` and an empty list, HTTP 200 — this is a normal first-run state, not an error.

- [ ] **Step 2: Implement**

`Handler` gains `do_PUT`. The settings file path comes from the server, alongside `journal_path`, following the existing `_Server` pattern rather than a global.

Field names cross the wire in camelCase, matching `tile_json`'s existing convention.

- [ ] **Step 3: Verify, gate, commit**

```bash
git commit -m "feat(desktop): serve settings and the adapter list"
```

---

### Task 4: Starting and stopping dumpcap

**Files:**
- Create: `services/collector/src/dw_collector/desktop/capture.py`
- Test: `services/collector/tests/test_desktop_capture.py`

- [ ] **Step 1: Write the failing tests**

The supervisor must be testable without Npcap, so it takes the executable path as a parameter and the tests point it at a **stub**: `sys.executable` running `-c` with a small script that sleeps. That proves spawn, status and stop without capturing a single packet.

Test:
1. `ring_argv(dumpcap, interface, capture_dir)` produces exactly the arguments from `register-tasks.ps1:250` — `-i`, `-f "tcp port 8680"`, `-w <dir>\cap.pcapng`, `-b duration:15`, `-b files:5760`, `-B 64`. **Assert the whole list**, because a silently wrong filter captures nothing and looks fine.
2. `start()` against the stub reports running, and `status()` says so.
3. `stop()` ends it, and `status()` then says stopped.
4. `start()` twice does not spawn a second process.
5. `start()` with a capture directory that does not exist creates it — a player will name one that does not exist yet.
6. `stop()` when nothing is running is a no-op, not an error.

- [ ] **Step 2: Implement**

`capture.py` holds a `Supervisor` with `start`, `stop`, `status`. It spawns `dumpcap` with `CREATE_NO_WINDOW`, keeps the `Child`, and — **reusing what Task 9 of the previous plan learned** — stops it by process tree on Windows, not by PID alone, since a killed parent can leave a child capturing. Read `apps/desktop/src-tauri/src/main.rs`'s `kill_tree` and `docs/runbooks/desktop-sidecar-lifecycle.md` before writing the stop path, and mirror the reasoning in a comment.

- [ ] **Step 3: Verify, gate, commit**

```bash
git commit -m "feat(desktop): supervise dumpcap as a child of the app"
```

---

### Task 5: The ingest loop

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/capture.py`
- Test: `services/collector/tests/test_desktop_capture.py`

- [ ] **Step 1: Write the failing tests**

Ingest reuses `cli.py`'s existing machinery rather than a second copy. Test that:
1. A `.pcapng` fixture already in the repo, dropped into the capture directory, is ingested into the journal and its name recorded in `ingested_captures`. **Find an existing fixture** — search `services/collector/tests/` for `.pcapng` files and use a real one rather than inventing bytes.
2. Running ingest twice does not double-count: `ingested_captures` is what prevents it.
3. A file still being written (younger than the min age) is skipped.

- [ ] **Step 2: Implement**

A loop on a thread, polling the capture directory, calling the same ingest path `cli.py` uses. It writes to the same journal the read layer reads.

**One thing to get right:** the journal now has two writers in one process — the ingest loop and nothing else, since `localread` only reads. Check `Journal`'s `single_writer_thread` parameter (`capture/__main__.py:40` sets it) and say in a comment which thread owns writes.

- [ ] **Step 3: Verify, gate, commit**

```bash
git commit -m "feat(desktop): ingest the ring into the local journal"
```

---

### Task 6: Capture control over the sidecar

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/sidecar.py`
- Test: `services/collector/tests/test_desktop_sidecar.py`

- [ ] **Step 1: Tests, then implement**

`POST /capture/start`, `POST /capture/stop`, `GET /capture/status`. Status reports whether dumpcap is running, how many files are in the capture directory, and how many rows the journal holds — the three numbers that distinguish "working" from "running but seeing nothing", which is the failure mode `capture/__main__.py`'s health logging exists for.

Starting with no interface configured must return 400 with a sentence naming what is missing, not spawn dumpcap with an empty `-i`.

- [ ] **Step 2: Verify, gate, commit**

```bash
git commit -m "feat(desktop): start, stop and report capture"
```

---

### Task 7: The settings screen

**Files:**
- Create: `apps/desktop/src/settings.ts`
- Modify: `apps/desktop/src/main.ts`, `apps/desktop/index.html`
- Modify: `apps/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Rust commands**

Add commands proxying the five new endpoints, following the existing `find`/`health` shape: get the port via `port_of`, `reqwest`, surface a non-2xx body's `error` field as `Err`.

- [ ] **Step 2: The screen**

A form: adapter as a **dropdown populated from `/adapters`** (never a free-text field — a hand-typed NPF device is the single most likely thing to be wrong and it fails silently), capture directory, server id, journal path, and a read-only collector id.

**`textContent` only.** `csp` is still `null`, and adapter labels come from outside the program.

When `/adapters` reports `no-dumpcap`, the screen says Npcap is not installed and links to it rather than showing an empty dropdown.

- [ ] **Step 3: MANUAL — the whole flow on a real machine**

With Npcap installed, BlueStacks running and the game connected: open the app with no settings file, pick the adapter, set a capture directory, press Start, and confirm within a few minutes that the capture directory fills, the journal row count climbs, and a search finds a base that was not there before.

**Report each number.** No test in this plan covers this, and it is the only thing that proves the phase.

- [ ] **Step 4: Confirm capture stops with the app**

Close the window and confirm with `tasklist | findstr /i dumpcap` that no `dumpcap` process survives. This is the behaviour change this plan chose deliberately; if it does not hold, the child-process decision needs revisiting rather than the test.

- [ ] **Step 5: Gate and commit**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
git commit -m "feat(desktop): configure and run capture from the window"
```

---

## Done when

- `uv run pytest` passes in `services/collector/`.
- `pnpm check && pnpm typecheck && pnpm test && pnpm build` passes at the root.
- A player with no `.env` can pick an adapter and start capture from the window.
- Closing the window leaves no `dumpcap` and no `dw-sidecar` process.
- The manual steps in Tasks 2, 7.3 and 7.4 are recorded with real numbers.

## What this deliberately does not do

- No BlueStacks control. `ui_worker/instances.py` already resolves instances by window title and proves them with a handshake, and the settings screen could surface it — but nothing here needs it, and capture works whether the emulator was started by the app or by hand.
- No scheduled tasks, and no migration for anyone already using them. `register-tasks.ps1` keeps working for this repo's own collector, untouched.
- No sync. The app stays local-only, per ADR 0001.
