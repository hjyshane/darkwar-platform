# The local screens — profile, roster, arena

Three screens over one account's own journal: `apps/desktop/src/profileView.ts`,
`rosterView.ts`, `arenaView.ts`, each backed by a projection in
`services/collector/src/dw_collector/desktop/localread/` and a read endpoint on
the sidecar (`localread.py`'s docstring calls out tiles; these three followed
the same pattern once it existed). Read this before touching any of the three —
the two folds below are not obvious from the code alone, and getting either one
wrong reintroduces a bug this repo has already paid for once.

## What each screen reads

| Screen | `target_table`(s) | Projection | Endpoint |
|---|---|---|---|
| Profile | `player_snapshots`, `player_detail_snapshots` | `localread/players.py` (`PlayerProfile`), `localread/player_detail.py` (`PlayerDetail`) | `GET /players?q=`, `GET /player/<uid>` |
| Alliance roster | `alliance_member_snapshots` | `localread/roster.py` (`RosterEntry`, `roster()`) | `GET /roster` |
| Arena bracket | `arena_snapshots` + `arena_entries` + `arena_entry_heroes` | `localread/arena.py` (`ArenaBoard`) | `GET /arena?league=` |

All three follow the projection pattern `localread.py` established for tiles:
a frozen dataclass, a SQL select ordered by `n.id` (keeps the covering index
`(target_table, id)` and makes tie-breaks deterministic), a per-row parse whose
*whole body* is inside a `try/except (ValueError, KeyError, TypeError,
AttributeError)` guard — not just the JSON decode, because a `row_json` that
decodes fine but holds the wrong shape (a string where an object was expected,
a list where a scalar was expected) raises just as surely as bad JSON does —
and a fold that turns many sightings into the one view the screen shows.

## The two folds that are not obvious

### Profiles: newest non-null wins, per field — not per row

Three normalizers write `player_snapshots`, and each leaves different columns
null: `kill_rank.py` gives `kills`/`rank` but `power`/`hq_level`/
`alliance_external_id` are always `None` — not because a player lost them, but
because `kill.rank`'s response never carries them. `server_rank.py` is the
mirror image (`power`/`hq_level` real, `kills` always null). `get_user_info_multi.py`
gives almost everything but `rank` is always `None` there (the field reads `0`
on every capture — not a real rank of zero). A fourth normalizer,
`get_new_user_info.py`, doesn't write this table at all — it writes
`player_detail_snapshots` instead, which is why that table gets its own
projection (`player_detail.py`) rather than a field bolted onto `PlayerProfile`.

A plain "newest row wins, whole" fold — the one `tiles.newest_per_player`
correctly uses, because tiles have exactly one writer — would be wrong here:
a player last touched by `kill.rank` would show null `power` and null
`hq_level`, having had both a minute earlier from `server.rank`. So
`players.py`'s fold (`merge_player_snapshots`, via `_FieldTimeline`) tracks
each field's *own* newest non-null value independently. `captured_at` on the
merged `PlayerProfile` is still the newest of *any* contributing sighting —
it answers "when did we last see this player at all", not "when was this
exact combination of fields true together", because no such single moment
necessarily exists once the fields come from different commands.

**The accepted limitation, spelled out because it is easy to miss:** a
structural null (this command never reports this field) and a real null
(the player genuinely has no alliance right now because they left one) are
indistinguishable once they've both become `None` on a row. Newest-non-null-
wins means a "player left the alliance" signal from a fresh
`get.user.info.multi` row is *skipped* — the profile keeps showing the last
alliance actually observed, stale, until some other positive fact overwrites
it. This is not a new problem invented for this module: `CLAUDE.md` records
the identical trade-off one level up, at the cloud layer —
`players.current_alliance_id` is a last-known value nothing ever clears,
specifically because clearing on an ambiguous absence has already been shown
to erase real membership (it named 94 players for a roster of 84). A
newest-*row*-wins fold does not fix this either — it would correctly clear
the alliance on the `get.user.info.multi` row that reports none, but would
*also* incorrectly clear it (and power, and HQ level) on the very next
`kill.rank` row, which is strictly worse. Given a choice between two failure
modes, this module accepts the quieter one, and says so on screen: the
profile view never claims exactness it doesn't have (see `componentsSumMatches`
below).

`player_detail_snapshots` (`player_detail.py`) does **not** need this fold —
it has exactly one writer (`get_new_user_info.py`), so a plain newest-row-wins
is already correct, and folding it into `PlayerProfile` would force every
other caller of that profile to carry three always-null fields for one
command's sake. What it does carry, and must never quietly drop, is
`components_sum_matches`: `null` means too few components were captured to
check at all, `false` means the six power components did **not** sum to
`power_total`. The profile screen shows the total either way, but always
alongside a sentence saying whether it can be trusted — presenting an
unverified total as if it were exact would be worse than showing nothing.

### Roster: membership of the newest snapshot, not everyone ever seen

`al_rank.py` writes one `alliance_member_snapshots` row per member, per
`al.rank` call, and a member who leaves the alliance simply stops appearing in
the *next* call's rows — their earlier rows are never deleted. A fold across
"every member ever seen, newest row each" (the `players.py`/`tiles.py` style,
keyed on `game_uid`) would show every departed member forever. `CLAUDE.md`
already records this exact bug at the cloud layer: `players.current_alliance_id`
named 94 people for a roster of 84, because leaving was never recorded and the
column is a last-known value nothing clears.

`roster.py`'s fix is a different key entirely: every member row from one
`al.rank` call shares the same `observation_id` (stamped by `al_rank.normalize`),
and nothing shared across two different calls. `newest_roster` groups by
`observation_id`, keeps only the newest group (by `captured_at`, tie-broken by
insertion order), and returns *that* group's rows — never a union across
groups. A member missing from the newest call's response is simply absent from
the roster this module reports, the same way they'd be absent from the game's
own roster screen. This was proven with a test, not just argued: two snapshots
where the second omits a member, asserting the roster shows the second
snapshot's membership only.

`presence_redacted` is a property of the *snapshot*, not of any one member —
the game hides another alliance's true online state by reporting everyone
online with zeroed timestamps, and `al_rank.normalize` computes this once per
response. `roster.py` surfaces it once, at the roster level; the screen turns
it into a plain-English banner and renders every member's online cell as
"unknown" rather than displaying a state it knows is faked.

## Arena: the join happens in Python, because `normalized_rows` has no keys

`normalized_rows` has no foreign keys — every target table is a `row_json`
blob keyed only by its own `idempotency_key`. Arena is the first projection
that needs data from *three* related tables (`arena_snapshots`,
`arena_entries`, `arena_entry_heroes`), so `arena.py` reads each table back out
as JSON and joins them in Python, using linking fields that live *inside*
`row_json`, verified against `normalize/arena.py` rather than assumed from
column names:

- `arena_entries.arena_snapshot_id` matches the **header** row's own
  `snapshot_id` — the obvious one, and named for it.
- `arena_entry_heroes.arena_entry_id` matches the **entry** row's own
  `snapshot_id` field — *not* a separate id anyone assigns for "which entry
  this hero belongs to". `normalize()` builds the entry row with
  `"snapshot_id": str(stable_uuid(entry_key))`, and calls `_lineup_rows()`
  with that same `entry_key`, which in turn writes every hero row with
  `"arena_entry_id": str(stable_uuid(entry_key))` — the identical expression.
  So one entry row's `snapshot_id` column doubles as that row's own primary
  key *and* as the value its hero rows carry as `arena_entry_id`. This is not
  guessable from the column names alone — the header's own id is what
  `arena_snapshot_id` matches, and the header's `snapshot_id` is never
  repeated on any other table's rows.

Two more things worth knowing before changing this module:

- **League is folded independently.** Gold (cross-server) and Silver
  (own-server) are two separate header lineages sharing one command; folding
  across both the way `roster.newest_roster` folds across `observation_id`
  groups would let one league's newest snapshot silently replace the other's,
  depending only on capture order. `newest_header_per_league` groups by
  `league` first, so each keeps its own newest snapshot regardless of which
  was captured last — confirmed against the real journal, which held a Gold
  snapshot from 41 days ago and a Silver snapshot from 45 minutes ago at the
  same time, each rendering its own staleness independently of the other.
- **A heroless entry still appears.** `_lineup_rows` writes zero hero rows
  when the `army` blob is blank or doesn't decode — a real, expected shape,
  not a parse failure. `arena_boards` attaches whatever hero rows exist and
  leaves `heroes` empty otherwise; nothing drops the entry itself for lack of
  a lineup, which is why the screen renders a disabled "no lineup" button
  instead of hiding the row.

## How to seed the journal to exercise each screen

The journal has no schema beyond four tables — `raw_observations`,
`normalized_rows`, `sync_outbox`, `ingested_captures` — so seeding is two
inserts per sighting, following the shape `test_desktop_localread.py` and
`test_desktop_localread_arena.py` already use:

1. One row in `raw_observations` (a synthetic `observation_id`,
   `source_command`, `captured_at`, `collected_from_server_id`; `payload_json`
   can be `"{}"` for a seed — the projections never read it).
2. One row per fact in `normalized_rows`, with `target_table` set to the table
   name from the list above, `row_json` shaped `{"row": {...fields...}}`, and
   a unique `idempotency_key`.

For the roster's "departed member" behaviour specifically: write two
`al.rank`-shaped snapshots under two different `observation_id`s, with the
second omitting one member who appeared in the first — the roster screen must
show the second snapshot's membership only. For arena's per-league fold:
write two `arena_snapshots` headers with different `league` values and
different `captured_at`, each with its own `arena_entries`/`arena_entry_heroes`
rows joined by the id scheme above. For the profile merge: write two or more
`player_snapshots` rows under different `source_command`s with complementary
nulls, and confirm the merged profile keeps the newest non-null value per
field rather than the newest row's nulls stomping on an older row's data.

## Coverage follows attention

These screens show what the player looked at in game — a profile exists only
for uids whose card was opened (or who showed up incidentally in a roster or
rank-board response), a roster is exactly as fresh as the last time the alliance
tab was opened, an arena board only as fresh as the last time that screen was
opened. Verified directly against the real journal on this machine
(`%APPDATA%\us.cbfw.darkwar.desktop\collector.db`) on 2026-09-07: the profile
screen resolved a merged, non-stale profile for a uid with three complementary
snapshots and a separately-stale one for a uid last seen 21 days ago (correctly
marked "stale, may no longer be accurate", and correctly flagged
`components_sum_matches: false` where the seeded components didn't add up);
the roster screen showed two members and correctly omitted a third who was
present only in the older of two seeded snapshots; the arena screen showed a
Gold board from 41 days ago (marked both "not the current week" and stale) and
a Silver board from 45 minutes ago (marked neither) in the same response, each
independently.

An empty screen is therefore not automatically a bug: "no arena rows" or "no
roster snapshot yet" usually means this account's owner never opened that
screen in game, not that the projection or endpoint is broken. What *would* be
a bug is an empty screen that says nothing — every screen here must render a
sentence explaining the emptiness (`"No alliance roster has been captured
yet."`, `"No arena bracket has been captured yet."`) rather than a blank div,
and must say when its data was captured whenever it has any, with anything
older than a day marked stale in both a CSS class and in the sentence itself —
a reader skimming, or unable to see color, still needs to be told.
