# Local Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app shows a player their own profile, their alliance's roster, and their arena bracket — from their own capture, with no cloud.

**Architecture:** Each screen is a projection over `normalized_rows` in `localread.py`, a read endpoint on the sidecar, and a plain-DOM view. A view registry is built first, because three more screens will not fit the current ad hoc switching.

**Tech Stack:** Python 3.12 (stdlib), TypeScript, plain DOM, pytest, vitest.

---

## Scope, and what was cut

ADR 0001's phase 5 said "player detail, alliance, arena, rank boards and server statistics". Investigation cut the last two, and the ADR is amended in Task 6 to say so.

**Building, because one account genuinely sees each of these in full:**

| Screen | Command | Why it is real |
|---|---|---|
| Own profile | `get.new.user.info`, `get.user.info.multi` | `capture-sweep.md` records 97 distinct players observed incidentally from ordinary play, with 20/20 component sums matching. |
| Alliance roster | `al.rank` | The first step of `routines/example-alliance-daily.json`. **Not degraded by being single-account** — a member sees the whole roster in game, so the local copy is complete, not a fragment. |
| Arena bracket | `user.get.arena.info` | A Top-100 fetch every time the arena screen opens. Self-contained: the player's own bracket, whole. |

**Not building:**

- **Cross-server rank boards.** `server.rank` and `kill.rank` are routine to *see*, but they return only the window the observing account's request happened to cover. A local board would be a stale, partial mirror of something the player already saw once in game, and it could never be made complete or kept fresh. The dashboard's versions work because they aggregate one collector's sweeps across eight servers; a lone capture has no equivalent.
- **`rank.get.by.range` in any form.** `docs/runbooks/capture-sweep.md:130` records the verdict **거절 (rejected)**: "power" means different things per board type and does not reconcile with true power. That is a schema defect, not a coverage gap. Do not build on it, and do not quietly reintroduce it as "just one more metric".
- **Server statistics.** Needs every alliance and every player on a server.
- **Season boards.** Cross-alliance rankings, and `season-map-capture.md:588` records that per-member season-building attribution has never been observed at all.

Cutting these is the point, not a shortcut. A screen that shows a partial, unrefreshable mirror of a ranking is worse than no screen: it looks authoritative and is not.

## Background the engineer needs

**The projection pattern**, established by `localread.py` and to be followed exactly:

1. A frozen dataclass as the target.
2. Raw SQL selecting `row_json` joined to `raw_observations` for `captured_at`, filtered by `target_table`, **ordered by `n.id`** — that ordering is deliberate, it keeps the query on the covering index `(target_table, id)` and makes the fold's tie-break deterministic.
3. A guarded per-row parse that returns `None` on anything malformed. **The whole parse is inside the guard**, not just the JSON decode — a `row_json` that is valid JSON but not an object raises `AttributeError` on `.get`, and a coordinate stored as a string raises `ValueError` on `int()`. Both used to escape and kill the entire read.
4. A fold collapsing many sightings to one current view, keyed appropriately, newest wins.
5. A freshness-keyed cache only if the screen will poll or sit behind typing. The existing one is keyed on the **journal file**, not the connection — the sidecar opens a fresh connection per request, so a connection-keyed cache never hits and leaks an entry per request.

**The endpoint pattern**, from `/find`:

- Check `journal_state()` first; a missing or unreadable journal is a **503 with a sentence**, never a dropped connection.
- Open a fresh `sqlite3.connect` per request and close it.
- camelCase on the wire.
- **A `game_uid` crosses as a STRING.** It is sixteen digits and `Number.MAX_SAFE_INTEGER` is sixteen digits — a uid serialized as a JSON number is one order of magnitude from silently becoming a different player. `tile_json` already does this; every new formatter must too.

**The UI rule that does not bend:** `textContent` only. Never `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or markup from template strings. Every name on these screens was chosen by another player, and `tauri.conf.json` still has `csp: null`.

**Coverage follows attention.** These screens show what the player looked at. A roster is as fresh as the last time they opened it; a profile exists only for players whose cards they opened. Every screen must say when its data was captured — the same "we did not look" versus "nobody is there" distinction `find.Scan.covered` draws, one level up. A screen that shows stale numbers without saying they are stale is the failure mode this whole app is trying to avoid.

## File Structure

**Python** — `services/collector/src/dw_collector/desktop/`

| File | Responsibility |
|---|---|
| `localread.py` | Gains projections for profiles, roster, arena. Already holds tiles. |
| `sidecar.py` | Gains three read endpoints. |

If `localread.py` passes roughly 400 lines, split it by subject (`localread/tiles.py`, `localread/players.py`, …) keeping the shared SQL and cache helpers together — `CLAUDE.md` asks for files that stay readable.

**TypeScript** — `apps/desktop/src/`

| File | Responsibility |
|---|---|
| `views.ts` | The view registry: which view is showing, and its enter/exit. |
| `main.ts` | Shrinks. Wiring only. |
| `profileView.ts`, `rosterView.ts`, `arenaView.ts` | One per screen. |

---

### Task 1: A view registry, before any new screen

**Files:**
- Create: `apps/desktop/src/views.ts`
- Modify: `apps/desktop/src/main.ts`, `apps/desktop/index.html`

`main.ts` is 573 lines. Views switch by setting a `hidden` attribute directly, each tab's handler hand-writes its own enter and exit work — `showSettingsView` starts a poll, `showSearchView` remembers to stop it — and the map is appended unconditionally inside the search view rather than being a view at all. Three more screens copy-pasted into that will leak a poll interval the first time somebody forgets a teardown.

- [ ] **Step 1: Write the registry and its tests**

`views.ts` owns a small registry: a view has an id, its container element, and optional `onEnter`/`onExit`. Showing one hides the rest and runs the pair of hooks. Design the exact shape yourself.

Test it directly with stub elements: showing a view runs its `onEnter`; showing another runs the first's `onExit`; showing the same one twice does not re-enter; **an `onExit` that throws does not prevent the next view showing** — a broken teardown must not trap the user on a screen.

`apps/desktop` has no vitest suite today, only the `echo` placeholder noted in the previous plan as needing replacement. **This is the moment**: wire vitest properly, following `packages/ui`'s config, and replace the placeholder `test` script.

- [ ] **Step 2: Move the existing views onto it**

Search, settings and map become registered views. The settings poll becomes its `onEnter`/`onExit`, replacing the manual calls.

**Behaviour must not change.** The map currently lives inside the search view; decide deliberately whether it stays there or becomes its own view, and say which and why in your report.

- [ ] **Step 3: Verify by hand**

`pnpm app` from `apps/desktop/`. Switch between every view twice. Confirm: each still works, the settings poll starts on entering and stops on leaving (watch the sidecar's request log or add a temporary counter), and no view is left visible when another is shown.

Report what you observed.

- [ ] **Step 4: Gate and commit**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
git commit -m "refactor(desktop): give the window a view registry before it grows"
```

---

### Task 2: Reading profiles out of the journal

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/localread.py`
- Test: `services/collector/tests/test_desktop_localread.py`

Two tables carry profile data and they are not interchangeable:

- `player_snapshots` — `server_id, game_uid, name, alliance_external_id, hq_level, power, kills, rank, month_card_expires_at`
- `player_detail_snapshots` — `server_id, game_uid, power_total, power_components, components_sum_matches`, with `player_component_power_snapshots` carrying `metric, power, name, unit_id` rows alongside

- [ ] **Step 1: Read the normalizers before writing anything**

`normalize/get_new_user_info.py`, `normalize/get_user_info_multi.py`, `normalize/kill_rank.py` and `normalize/server_rank.py` all write `player_snapshots`, with **different fields populated and others null**. `kill_rank` gives kills but null power; `server_rank` gives power but null kills.

So a fold that simply takes the newest row will erase a field a different command supplied. **Decide how to merge and say why in a comment** — newest-non-null per field is the obvious candidate, but it has its own trap: a value that legitimately became null cannot be distinguished from one that was never there. Work out what is honest here and write it down.

- [ ] **Step 2: Tests first**

Cover: a profile assembled from one command; a profile merged across two commands with complementary nulls; the newest value winning when both supply the same field; a malformed row skipped without killing the read; `components_sum_matches` surfaced rather than hidden, because a profile whose components do not add up is one the screen must not present as exact.

- [ ] **Step 3: Implement, following the established pattern**

Dataclass, SQL ordered by `n.id`, whole-parse guard, fold. Add a cache only if the screen will poll.

- [ ] **Step 4: Gate and commit**

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
git commit -m "feat(desktop): read player profiles out of the local journal"
```

---

### Task 3: The profile screen

**Files:**
- Modify: `services/collector/src/dw_collector/desktop/sidecar.py`, `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/profileView.ts`
- Tests both sides

- [ ] **Step 1: The endpoint**

`GET /players?q=` searching by uid or name, and `GET /player/<uid>` for one. Follow `/find`: `journal_state()` first, fresh connection, camelCase, **uid as a string**.

- [ ] **Step 2: The screen**

Search by uid or name, show the profile: name, power, HQ, kills, alliance, and the power components.

**It must show when each number was captured**, and mark anything older than a day as stale. A profile from three weeks ago presented as current is a wrong answer with a confident face.

Where `components_sum_matches` is false, say so — do not present a total the parts disagree with.

`textContent` only.

- [ ] **Step 3: See it work**

Against the real journal at `%APPDATA%\us.cbfw.darkwar.desktop\collector.db`. If it holds no profile rows, seed one from the normalizer's own test fixtures and say that you did.

Screenshot it. Report what the screen showed and whether the capture times rendered.

- [ ] **Step 4: Gate and commit**

Both gates. `git commit -m "feat(desktop): show a player's profile from local data"`

---

### Task 4: The alliance roster

**Files:** `localread.py`, `sidecar.py`, `apps/desktop/src/rosterView.ts`, plus tests

`al.rank` writes `alliance_member_snapshots`: `server_id, game_uid, name, member_rank, hq_level, power, kills, presence_redacted, month_card_expires_at, online_state, offline_since`.

- [ ] **Step 1: Projection and tests**

Fold to one row per member at their newest sighting. **A member who left the alliance stops appearing in new snapshots but their old rows remain** — so the roster must be the membership as of the newest snapshot, not every member ever seen. Getting this wrong shows ex-members forever, which is a bug this repo has already had once at the cloud layer: `CLAUDE.md` records that `players.current_alliance_id` named 94 people for a roster of 84 because leaving was never recorded.

Test that explicitly: two snapshots where the second lacks a member, and the roster shows the second's membership.

- [ ] **Step 2: Endpoint and screen**

`GET /roster`. A table: name, rank, HQ, power, kills, online state. Sortable is nice, not required.

Show the snapshot's capture time prominently — a roster is exactly as fresh as the last time the player opened that screen in game.

`presence_redacted` exists for a reason; read the normalizer and respect whatever it means rather than displaying it raw.

- [ ] **Step 3: Real data, screenshot, gates, commit**

`git commit -m "feat(desktop): show the alliance roster from local data"`

---

### Task 5: The arena bracket

**Files:** `localread.py`, `sidecar.py`, `apps/desktop/src/arenaView.ts`, plus tests

Three tables: `arena_snapshots` (header: `week_start`, `entry_count`, `league`), `arena_entries` (`game_uid, name, rank, score, defense_power, alliance_name`), `arena_entry_heroes` (the lineup).

- [ ] **Step 1: Projection and tests**

This is the first projection spanning three related tables, joined by `snapshot_id` and `arena_entry_id`. Work out how those ids survive into `normalized_rows` — they are fields inside `row_json`, not database keys, so the join happens in Python after parsing.

Fold to the newest snapshot per league. Test: two snapshots, the newer wins; entries attach to the right snapshot; heroes attach to the right entry; an entry whose heroes are missing still shows.

- [ ] **Step 2: Endpoint and screen**

`GET /arena`. The bracket table with rank, name, score, defense power, alliance. The hero lineup on demand rather than always — it is a lot of columns.

Show `week_start` and the capture time: an arena bracket is a weekly thing and last week's is not this week's.

- [ ] **Step 3: Real data, screenshot, gates, commit**

`git commit -m "feat(desktop): show the arena bracket from local data"`

---

### Task 6: Prove it against real data, and amend the ADR

- [ ] **Step 1: Run it against a real journal**

Open the app against the actual journal on this machine and visit all three new screens.

**Report honestly what each one showed** — including "empty, because this journal has no arena rows". An empty screen that says why is a correct result for this task; an empty screen that says nothing is a bug.

- [ ] **Step 2: Check the staleness story end to end**

For each screen, confirm the capture time renders and old data is marked stale. This is the promise the whole app rests on: it shows what the player looked at, and it says when.

- [ ] **Step 3: Amend ADR 0001**

Phase 5 in `docs/adr/0001-user-app-is-local-only.md` says "player detail, alliance, arena, rank boards and server statistics". Rank boards and server statistics were cut. Update it to say what was built and **why the rest was not** — one account's capture returns only its own window of a ranking, so a local board is a stale partial mirror; and `rank.get.by.range` was rejected outright by `capture-sweep.md:130` for a schema defect.

An ADR that quietly disagrees with the code is worse than no ADR.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(adr): record which local screens were built, and why the rest were not"
```

---

## Done when

- All three screens render from the real local journal, or say plainly why they are empty.
- Every screen shows when its data was captured and marks stale data.
- `uv run pytest` and the root `pnpm` gate both pass.
- `apps/desktop` has a real test suite instead of the `echo` placeholder.
- ADR 0001 says what was actually built.

## What this deliberately does not do

- No rank boards, no server statistics, no season boards — see the scope section.
- No writes. Every screen here is a read of what the collector already captured.
- No cloud. Still local-only, per ADR 0001.
