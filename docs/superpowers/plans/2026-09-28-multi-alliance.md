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
   the alliance switcher, shown to admins and to members of both. Black Money
   tables stay member-readable across alliances (as before); RLS scoping them
   would also hide the enemy rows the opponents view reads.
5. **Pin the second alliance.** OwnAllianceSetting becomes a list. Only now is
   a second `is_own` row possible.

Each phase: pgTAP (RLS negative test per scoped table, §20.2), local gate,
`scripts/pgtap/run.sh`, then read the CI `db` job before merging.
