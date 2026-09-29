# Multi-alliance support

Goal: a second "main" alliance alongside CBFW, with its own members, boards,
settings and alliance tab, sharing Overview and Map.

## Decisions (2026-09-28)

| Question | Answer |
|---|---|
| Which alliance | Generic N-alliance support; admin pins the second one from Settings. |
| Officer scope | Per alliance. `admin` stays global over every alliance. |
| Events tab | One tab, a toggle picks the alliance, defaults to the active one. |
| Delivery | Phased PRs. Every merge to `main` is a prod release, so each phase must be safe alone. |

Shared (not alliance-scoped): Overview, Map, `hive_map_features` (a building's
size is a fact about the game), hero/pet catalogues, `role_permissions` grid.

Scoped per alliance: alliance tab (members, hive), Boards (notices, guides),
Schedule, Settings (rank tiers, formulas, score weights, Discord routing),
join codes, player claims, rank periods, roster cache.

## Today: one flag carries everything

- `alliances.is_own` is resolved from ONE pin, `app_settings.own_alliance =
  {alliance_id}` (0032). ~10 views/functions filter `is_own` with no
  `alliance_id` partition (member_roster, build_rank_period,
  alliance_power_history, hive_formation_board, member_season_buildings, ...).
- `app_users.role` is one global role; `current_app_role()` / `has_permission()`
  read it. Nothing about membership names an alliance.
- Client: `useOwnAlliance()` = `.eq('is_own', true).limit(1)`.

**The hazard:** pinning a second alliance before those views partition by
alliance merges both rosters, rank tables and boards into one. So the UI that
pins a second alliance ships LAST (Phase 5), and until then `own_alliance`
must hold exactly one id.

## Mechanism: active alliance travels as a request header

The dashboard sends `x-alliance-id` on every PostgREST request.

- `active_alliance()` = that header if the caller is admin or holds a
  membership there and it is an own alliance; else the caller's only
  membership; else the first own alliance.
- `current_app_role()` = `admin` if `app_users.role = 'admin'`, else the
  caller's role in `alliance_memberships` for `active_alliance()`, else
  `viewer`.

Every existing `current_app_role()` / `has_permission()` policy becomes
per-alliance without being rewritten. Alliance-owned tables additionally
check `alliance_id = active_alliance()`, which is what stops a member of A
from reading B by sending B's header (they would be `viewer` there).

Service role bypasses RLS; the collector and dw-notify are unaffected.

## Players (decided 2026-09-28)

One account (one email) may be any number of players — a character per
alliance, or alts in one. Each player belongs to at most one account.
`user_players` is the truth; `app_users.player_id` stays as the display
player (six views name authors through it) and is mirrored into
`user_players` by trigger.

## Sign-up

The alliance is picked on the first signed-in screen, not the sign-up form:
the list comes from `joinable_alliances()`, and 0168 keeps `anon` holding
nothing. The pick goes in the account's own auth metadata (a request, not a
grant); `pending_access.requested_alliance_id` shows it, and an officer sees
only the people waiting for the alliance they are viewing.

## Phases

1. **Schema, no behaviour change.** Plural pin (`alliance_ids`, legacy
   `alliance_id` still read). `alliance_memberships` backfilled from
   `app_users.role`, kept in sync by trigger while `app_users.role` is still
   authoritative. `alliance_id` on join_codes, player_claims, announcements,
   guides, schedule_categories, schedule_events, hive_formations,
   hive_formation_templates — backfilled to the pinned alliance and defaulted
   to it, so today's inserts keep working.
2. **Roles move.** `active_alliance()`, header-aware `current_app_role()`,
   `redeem_join_code` / `leave_alliance` / `remove_member` / member admin
   write memberships. Signup picks an alliance. Client `ActiveAllianceProvider`
   + header + switcher button (shown when >1 membership, or admin).
3. **Scoped content.** Boards, schedule, hive, join codes, claims: RLS adds
   `alliance_id = active_alliance()`; inserts take it from the active alliance.
   Per-alliance settings (app_settings gains alliance scope for the keys listed
   above; notification_channels keyed by alliance).
   *Done as 3a (0194, content scoping) and 3b (0195, members screen,
   app_users guards, `alliance_settings` for `rank_tiers`).* Discord routing
   per alliance is split out: the notifier must first learn which alliance
   each event belongs to.
4. **Derived tables partition.** rank_period_snapshots, member_roster_current,
   player_ranks, alliance_board_readings, black_money_signup_snapshots and the
   `is_own` views gain / group by `alliance_id`. Events tab toggle.
   *Done as 4a (0196: roster cache, rank build, rank tables, manual roster,
   hive board) and 4b (dashboard: "ours" = own AND viewed; overview and
   roster follow the viewed alliance; Black Money filtered client-side).*
   Events decision (2026-09-28): **own alliance only** — the Events toggle is
   the alliance switcher, shown to admins only (2026-09-29). Black Money
   tables stay member-readable across alliances (as before); RLS scoping them
   would also hide the enemy rows the opponents view reads.
5. **Pin the second alliance.** OwnAllianceSetting becomes a list. Only now is
   a second `is_own` row possible.

   *Done (0197 + the pin screen).* Changing the pin list freezes each
   non-primary alliance's per-alliance settings and moves a promoted
   primary's own values into the shared row, so no pin change moves anybody's
   numbers.

## Turning it on

Merging the stack changes nothing anyone sees — every phase is a no-op while
one alliance is pinned. The switch is the pin, and it is an admin's click.

1. Merge #304 → #305 → #306 → #308 → #310 → #311 → phase 5, in order, each
   after its CI `db` job is green (re-target each to `main` as its base
   merges). Each merge deploys the dashboard.
2. Push the migrations to production yourself (`supabase db push --workdir
   C:\darkwar-platform`; the assistant cannot). Check `supabase migration list`
   shows 0192–0197 applied and nothing out of order.
3. Smoke test with one pin, signed in as a member: role label, alliance tab,
   roster, boards, schedule, hive, rank report — all as before.
4. Settings → Our alliance → **pin as well** on the second alliance. It starts
   with a copy of the primary's rank tiers.
5. Settings → Join codes, while viewing the new alliance (switcher), issue its
   officers a code. Or let them sign up, pick it, and **Let in** from Members.
6. Its officers set its rank tiers and build a period while viewing it.

### The second alliance's scanner (ACE → BlueStacks window `lostidas`)

Capture is machine-wide, so anything opened in the `lostidas` window is
recorded with no setup. Automation drives exactly one window per run, chosen
by title from `instances.COLLECTOR_WINDOWS` (`collector` → CBFW,
`lostidas` → ACE); every other window, the main account's included, is
denied for that run, and a title off the list is refused outright.

- By hand: `uv run dw-ui-worker --instance lostidas run --routine <ace.json>`
  (also `probe`, `sweep`, `screenshot`, `devices`; or set `DW_UI_INSTANCE`).
- Queued: a `run_routine` job with `payload.instance = "lostidas"`.
- At logon: `register-cold-start.ps1 -Routine <ace.json> -Instance <Pie64_N>
  -Window lostidas` registers `DarkWar-ColdStart-lostidas` beside the
  existing task.
- Not yet: `dw-console` still manages only the `collector` instance.

### Discord per alliance (0199)

Each alliance has its own webhooks (`notification_channels.alliance_id`) and
its own routing: the primary's in `app_settings`, anybody else's in
`alliance_settings`, never inherited. Notices, guides, reminders, claims,
sign-ups (by the alliance asked for), departures and the rank-period
announcement go by their alliance's routing. Collector alerts (sync/data
stalled) stay on the primary's. Channel names are unique across the install.
Set up ACE's under Settings → Notifications while viewing ACE.

Schedule board keys are per alliance since 0203: the key is
`(alliance_id, category)` and an entry refers to its board by both.

### Settings per alliance (0200, decided 2026-09-29)

Only the catalogue is shared. Everything else under Settings follows the
alliance on screen, and the page says which one.

- **Per alliance:** Access (members, invitations, departures, activity,
  permission grid), Alliance (rank tiers, rank changes, scores and roster by
  hand), Display (overview figures, member columns, table columns, season
  building alert), Operations (Discord: webhooks, routing, delivery log).
- **Shared** (the old Catalogue group, same `#/admin/catalogue` address):
  heroes, pets, and the install itself — which alliances are pinned (admin
  only), collector health, unrecognized commands. One set of machines
  collects for every alliance, so there is nothing per-alliance to show.
- The permission grid is one full grid per pinned alliance
  (`role_permissions.alliance_id`). Rows with no alliance are defaults: a new
  capability seeded by a migration is copied to every pinned alliance as it
  is inserted, and a newly pinned alliance starts with a copy of the
  primary's grid. A seed must use `on conflict do nothing` or name
  `(role, capability, alliance_id)`.
- `app_settings` is written directly only by an admin or while viewing the
  primary; any other alliance writes through `save_alliance_setting`.
- Members and activity (0201): the Members list follows the viewed alliance
  for admins too (admin accounts are listed everywhere). Activity is recorded
  in the alliance on screen (`activity_events.alliance_id`), a comment counts
  in its post's alliance, and the activity list names the alliance's members
  by their role there. Everything before 0201 is CBFW's.

Each phase: pgTAP (RLS negative test per scoped table, §20.2), local gate,
`scripts/pgtap/run.sh`, then read the CI `db` job before merging.
