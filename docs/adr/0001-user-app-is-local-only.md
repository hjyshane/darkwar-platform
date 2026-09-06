# 0001 — The user app keeps its data local

Status: accepted, 2026-09-06. Supersedes nothing. First ADR in this repo.

## Context

The platform today is one collector — mine — feeding one Supabase project,
which serves one web dashboard at `https://cbfw.us`. Other players in the
group cannot answer "where is this base right now" without asking me.

Three shapes were considered and two were rejected before this one.

**An upload box on the map tab.** Rejected twice over, and `console/find.py`
already records why: a raw PCAP carries the capturing account's uid and
session signature, so uploading one puts a live credential into cloud
storage — and a capture handed over by another player is *their* credential
I would be holding. Restricting the box to admins changes who may upload, not
where the bytes land. Separately, the dashboard is a static site: decoding a
pcapng needs packet reassembly and a protobuf reader, neither of which exists
in a browser.

**A loopback decoder the web dashboard calls.** Built and reverted in the
same session. It worked, but the address is `127.0.0.1`, so the browser has
to be on the machine running the decoder — which is the machine the console
is already on. It moved the UI without moving the reach, and cost a second
process to keep alive.

What actually unblocks other players is not a way to send me their captures.
It is their own collector, on their own machine, on their own game account.

## Decision

**One: the user app never talks to my Supabase.** Their capture goes to their
own SQLite journal and stops there.

This is what makes bundling the map safe, and it falls out of the app being
user-based rather than shared. Nothing of theirs leaves their machine, so
there is no account data to leak, no secret to distribute, and no forged rows
in my database. It also sidesteps the blocker that would otherwise gate the
whole project: `cli.py` and `jobs/__main__.py` authenticate sync with
`SUPABASE_SECRET_KEY`, which bypasses RLS entirely. Shipping that key inside
a distributed binary would hand every user full read and write over
everything. Per-user auth across the sync path is a real migration, and going
local means it is not on this project's critical path.

`cbfw.us` is untouched. It keeps running on my collector alone.

**Two: Tauri, with the collector as a PyInstaller sidecar.** A real desktop
window is what makes this a thing you hand somebody rather than a thing you
talk them through. The React skills and the map rendering already exist in
this repo and carry over into the webview; the collector stays Python,
packaged as a sidecar binary the window starts and stops.

**Three: the app's dashboard shows everything local data supports** — map and
search first, then player detail, alliance, arena, rank boards and server
statistics. Normal play emits the commands behind all of these, so this is a
full dashboard over one account's own observations rather than a map with
extras. Scope is bounded by what that account looked at, not by what the
parsers can decode.

**Four: the window and the collector are one lifetime.** Tauri means two
processes, and the failure that matters is the window closing while the
Python half keeps running — an orphaned process still capturing packets.
This repo has already been bitten by that class of bug once, in Task
Scheduler reporting a task as Running with nothing alive behind it. Phase 0
exists to prove the child always dies with the parent, including on force
quit and on crash. The cost is accepted in exchange for Tauri's installer
and auto-updater, which are otherwise hand-built work that recurs on every
release.

## Consequences

### The user app's dashboard is a new dashboard, not a port

`apps/dashboard` has roughly 150 Supabase callsites across 25 feature
modules, and nearly all of them are *alliance* concepts: board, schedule,
roster, admin, auth, season boards, arena, rankings. None of those mean
anything on one player's own capture. Only the map, search and player-detail
family survive the move.

What should be shared is the drawing, not the querying. `MapCanvas` and
`mapProjection` become the first residents of `packages/ui`, which
`CLAUDE.md` has been holding a name for. The query layers stay separate on
purpose — one speaks PostgREST, the other speaks the local journal, and
pretending they are the same interface would leak cloud assumptions into the
app.

### `normalized_rows` is a staging format, not a schema

This is the largest hidden cost in the decision and it should be understood
before the work starts. The local journal has four tables —
`raw_observations`, `normalized_rows`, `sync_outbox`, `ingested_captures`.
Every one of the seventeen target tables (`world_city_snapshots`,
`player_snapshots`, `arena_entries`, and so on) lands as a JSON blob in
`normalized_rows` under a `target_table` tag. There are no typed columns and
no views.

`find.py` shows the pattern at one-screen scale: select where
`target_table = 'world_city_snapshots'`, parse the JSON in Python. That is
fine for one screen. A dashboard wants a read layer — SQLite views over
`json_extract`, or a materialize step — and every screen beyond the map needs
its own projection written and tested. "Everything local data supports" is
therefore a per-screen cost, not a one-time one.

### Local data covers what that account looked at

The collector observes what the game client requests, and normal play
requests a great deal: opening the alliance roster, the rank boards, arena
and a player card all emit the commands `normalize/alliance_rank.py`,
`arena.py`, `get_al_info.py` and their siblings already parse. So the app
fills across every screen, not only the map — a user's own alliance, their
own arena, the boards they check — and the dashboard is a real dashboard
rather than a map with extras.

The honest caveat is narrower than "empty": coverage follows attention.
Screens a user never opens in game stay blank, and a board they check weekly
is a week stale. That is the same "we did not look" versus "nobody is there"
distinction `find.Scan.covered` already draws, one level up, and every screen
needs its own version of it.

An earlier draft of this ADR claimed these screens would be mostly empty.
That was wrong and it mattered: it would have justified cutting scope to the
map alone.

### Configuration stops being environment variables

The collector reads twenty-plus `DW_*` variables through `envfile.py`. A
shipped app cannot ask users to write a `.env`, so these move behind a
settings screen with a persisted config file. The environment must keep
winning where it is set, so my own collector and CI are unaffected.

One trap is already known and must not be re-learned: **BlueStacks' adb port
moves between launches, and the stale port keeps listening and still answers
a connect.** A settings screen that stores a port number will therefore look
correct and be wrong. Resolution goes by window title and is proven by a
handshake, with the stored value treated as a hint.

### Npcap cannot be bundled

It is a driver with its own installer and licensing. The app detects it on
first run and links out; it cannot silently provide it. That makes a
first-run wizard mandatory rather than a nicety.

### The toolchain grows

Tauri adds Rust, and PyInstaller adds a Windows-only build step. CI runs on
Linux specifically to catch path and case assumptions, and it cannot build or
test this artifact — so the packaged app's build is verified locally, like
the merge gate already is. Development being Windows-only is a decision this
repo already made; this extends it to a release artifact.

### Two dashboards to keep alive

The map lives in two places now. The shared `packages/ui` residents are the
seam that keeps them from drifting visually; the queries will drift, and that
is intended.

### Distribution changes my position

Using a capture tool is one thing; handing it to other players makes me its
distributor, and the game's terms generally prohibit the category outright.
This ADR records that the risk was raised and accepted, not that it was
analysed.

## Plan

Each phase ends somewhere runnable. Phase 0 exists because it is the only one
that can invalidate the Tauri half of this decision, and it should fail fast
if it is going to.

0. **Sidecar spike.** A Tauri window that starts a PyInstaller-packaged
   Python process on Windows, calls it, renders the answer, and — the actual
   point — leaves nothing behind. The exit test is three-way: normal close,
   force quit from Task Manager, and the Rust side panicking. No product
   code. Revise decision two here if the lifecycle fights back.
1. **Local read layer.** SQLite views over `normalized_rows` for
   `world_city_snapshots`, plus a typed Python read API. Fixture-driven
   tests, per the repo's preference for fixture coverage over line coverage.
2. **Local API contract.** The sidecar's endpoints, versioned, tested without
   a window.
3. **Settings.** Adapter, capture directory, game port, server id, and
   BlueStacks resolution by window title with handshake proof. Persisted
   config, environment still wins. This phase is what removes "edit a .env"
   from the user's path.
4. **Map and search.** `MapCanvas` and `mapProjection` extracted to
   `packages/ui`, consumed by both dashboards. First screen a user sees.
5. **Remaining local screens.** Player detail, alliance, arena, rank boards
   and server statistics — each with its own projection over
   `normalized_rows`, its own tests, and its own way of saying how stale it
   is and whether it was ever looked at.
6. **Packaging and first run.** Npcap detection, wizard, installer,
   distribution.

## Not in scope

Per-user Supabase auth, opt-in sweep sharing back to `cbfw.us`, and any
change to the web dashboard's data path. If sweep sharing is wanted later it
is a new ADR, and its first paragraph is the RLS and collector-registration
work this one deliberately avoided.
