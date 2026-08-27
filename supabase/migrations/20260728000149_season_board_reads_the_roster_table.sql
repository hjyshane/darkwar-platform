-- 0149: the season board asks the 82-row roster TABLE who is a member,
-- instead of recomputing the whole group's roster from 1.76M snapshot rows
-- on every load.
--
-- The board died with `canceling statement due to statement timeout`.
--
-- Measured on production, service_role (RLS bypassed, so none of this is the
-- per-row RLS cost that 0104 and 0105 were about):
--
--   season_building_snapshots, one row          0.37 s  (24,349 rows total)
--   alliance_roster_latest, all rows            1.0  s
--   member_season_buildings, LIMIT 1            3.2  s
--   member_season_buildings_by_member, 500      5.6  s
--
-- A limit of one costing 3.2 s over a 24k-row table says the cost is not the
-- buildings. It is the join 0146 added: `alliance_roster_latest` aggregates
-- `alliance_member_snapshots` — 1,757,827 rows — TWICE, once for the newest
-- captured_at per alliance and once to size that batch, for EVERY alliance in
-- the group, to find the ~82 players this board cares about. A join's
-- equality condition does not push below a view's own aggregate; 0103 wrote
-- that down after the members table died of it at 363k rows. That table is
-- now five times bigger, and the season board is where it surfaced next.
--
-- Add a member session's per-row RLS quals on top of 5.6 s and the statement
-- timeout arrives before the rows do.
--
-- `member_roster_current` (0106) is the same question already answered: one
-- row per CURRENT member of the own alliance, 82 of them, maintained by
-- statement triggers on the writes that change it, pruned when somebody
-- leaves. `member_roster` — the members table the alliance reads — is built
-- on it. So this swap is not only cheaper, it is 0146's own argument carried
-- one step further: 0146 moved the board off `players.current_alliance_id`
-- because two screens were answering "who is in the alliance" differently,
-- and this moves it onto the very row set the members screen uses. Both
-- return 82 today; measured on production before the change, so the board's
-- contents do not move.
--
-- `alliances`/`is_own` drops out of the join because the table is already
-- scoped to the own alliance — 0106 picks it from the newest batch.
--
-- The column list is unchanged, so this is a replace rather than a drop:
-- `member_season_buildings_by_member` (0147) sits on top of this view and
-- survives untouched.

create or replace view public.member_season_buildings
with (security_invoker = true) as
select distinct on (b.player_id, b.building_type_id)
  b.player_id,
  p.current_name,
  b.game_uid,
  b.server_id,
  b.building_type_id,
  b.level,
  b.object_id,
  b.x,
  b.y,
  b.captured_at
from public.season_building_snapshots b
-- The roster, precomputed. One row per member, no aggregate underneath.
join public.member_roster_current r on r.player_id = b.player_id
join public.players p on p.player_id = b.player_id
where b.player_id is not null
order by b.player_id, b.building_type_id, b.captured_at desc;

comment on view public.member_season_buildings is
  'Season buildings for the CURRENT roster, newest level per member per '
  'type. Membership comes from member_roster_current (0106) — the same row '
  'set the members table reads — never from players.current_alliance_id and '
  'never from a read-time aggregate over alliance_member_snapshots.';

-- The DISTINCT ON key, in the order the view sorts it, so the newest level
-- per (member, type) is the first row of each index group rather than the
-- product of sorting every snapshot row that survives the join.
--
-- `season_building_player_captured_idx` (0138) stays: it answers "one
-- member's history", where captured_at leads and building_type_id does not
-- appear. It cannot serve this sort, because its second column is the one
-- this query orders third.
create index if not exists season_building_player_type_captured_idx
  on public.season_building_snapshots (player_id, building_type_id, captured_at desc)
  where player_id is not null;
