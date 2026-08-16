-- The growth views must read only the players they were asked for.
--
-- 29_growth_test and 38_directory_and_growth_test already pin what these views
-- ANSWER. Nothing pinned what they COST, and the cost is what broke: three
-- materialised CTEs meant a request for 94 members scanned 7,150 players three
-- times, which on production came back as `canceling statement due to
-- statement timeout`.
--
-- Asserting on the plan rather than on a stopwatch. A timing threshold in CI
-- is a flake generator, and the fault is not "slow" — it is structural, and it
-- shows up as a shape: does a filtered read use the player index, or does it
-- sort the table? That question has a stable answer on any size of database,
-- including the tiny one this suite runs against.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-00000000cf77', 'pushdown probe') on conflict do nothing;
insert into public.players (game_uid, server_id, current_name)
select 880000000000 + g, 580, 'Push' || g from generate_series(1, 400) g
on conflict do nothing;

-- 400 players x 12 snapshots. The count is load-bearing and was raised from 40
-- because the plan is only stable when the index is decisively cheaper, and 40
-- was not decisive: seq scan 19.00 against bitmap index 26.05, a gap small
-- enough that the environment decided the winner.
--
-- What decided it was index bloat, not table size. Every run of this file
-- inserts, rolls back, and leaves the pages behind; autovacuum truncates the
-- heap back to nothing but a btree never returns its pages, so on a database
-- that has run this suite a few times pg_class says the heap is 13 pages and
-- player_snapshots_player_captured_idx is 94 — the planner is told the index
-- is seven times the table it indexes, and picks the seq scan. That is why
-- the file passed on the run after `supabase db reset` and failed on the next.
-- ANALYZE below cannot repair it: ANALYZE recomputes heap relpages, and only
-- VACUUM touches an index's.
--
-- What defeats it is selectivity, not row count as such. A bitmap index scan
-- costs about relpages x selectivity, so holding snapshots-per-player at 12
-- and multiplying the players divides the index's share while the seq scan
-- pays for every row: at 400 the plan is 41.59 against a seq scan of roughly
-- 190, and the margin survives the index growing several times over. Raise the
-- player count, not the snapshots per player, if it ever narrows again.
--
-- Verified to still discriminate: the pre-0098 view definition, run against
-- this fixture, still plans `Seq Scan on player_snapshots` under its CTE.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, power, raw)
select gen_random_uuid(), 'server.rank', 1, 'push-' || p.player_id || '-' || s,
       now() - (s || ' days')::interval,
       '00000000-0000-4000-8000-00000000cf77', 580, p.player_id, 580, p.game_uid,
       1000000 * s, '{}'::jsonb
  from public.players p, generate_series(1, 12) s
 where p.current_name like 'Push%'
on conflict do nothing;

analyze public.player_snapshots;

create function pg_temp.plan_for(sql text) returns text language plpgsql as $$
declare
  line text;
  out text := '';
begin
  for line in execute 'explain (costs off) ' || sql loop
    out := out || line || E'\n';
  end loop;
  return out;
end;
$$;

create function pg_temp.one_player() returns uuid language sql as $$
  select player_id from public.players where current_name = 'Push1';
$$;

-- 1-3. A filtered read reaches the index. If a CTE that gets referenced twice
-- comes back, the qual stops at the materialisation boundary, the index goes
-- unused, and these fail.
select matches(
  pg_temp.plan_for('select * from public.player_power_growth where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  'player_snapshots_player_captured_idx',
  'player_power_growth reaches the player index when filtered');

select matches(
  pg_temp.plan_for('select * from public.player_growth_recent where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  'player_snapshots_player_captured_idx',
  'player_growth_recent reaches the player index when filtered');

select matches(
  pg_temp.plan_for('select * from public.player_power_history where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  'player_snapshots_player_captured_idx',
  'player_power_history reaches the player index when filtered');

-- 4. And none of them sorts the whole table to get there.
--
-- THIS is the assertion that discriminates; 1-3 above do not, on their own.
-- Checked by removing 0098 and running this file: assertion 1 passed against
-- the broken view, because the old plan still touched the index somewhere
-- inside its materialised CTE while scanning everything around it. A `Seq
-- Scan` of player_snapshots under a read filtered to one player is the
-- signature of the bug, and it is what actually goes red.
select unalike(
  pg_temp.plan_for('select * from public.player_power_growth where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  '%Seq Scan on player_snapshots%',
  'player_power_growth does not scan every snapshot to answer about one player');

select unalike(
  pg_temp.plan_for('select * from public.player_growth_recent where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  '%Seq Scan on player_snapshots%',
  'nor does player_growth_recent');

select unalike(
  pg_temp.plan_for('select * from public.player_power_history where player_id = '
                   || quote_literal(pg_temp.one_player()) || '::uuid'),
  '%Seq Scan on player_snapshots%',
  'nor does player_power_history');

-- 5. board_size counts the whole board, not just the filtered player — the
-- reason player_power_history could not simply have its window pushed under.
-- 12 snapshots per player were written as 12 separate observations, so each
-- board holds exactly one row here; the assertion is that the number is a
-- property of the observation rather than of the filter.
select is(
  (select distinct board_size from public.player_power_history
    where player_id = pg_temp.one_player()),
  1::bigint,
  'board_size counts the observation, not the rows that survived the filter');

-- 6. The index that makes that subquery cheap.
select has_index('public', 'player_snapshots', 'player_snapshots_observation_idx',
  'the observation index exists, or board_size scans the table per row');

-- 7. Still security_invoker, all three. These read a member-only table, and a
-- rewrite that dropped the setting would hand every reader the whole history —
-- the failure 0049 called out when it chose invoker in the first place.
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('player_power_growth', 'player_growth_recent',
                          'player_power_history')
        and (c.reloptions is null
             or c.reloptions::text !~ 'security_invoker=(true|on)') $$,
  'all three growth views still read with the caller''s rights');


-- 10-11. The component history view, added by 0099 for the same reason.
--
-- Its window partitions by observation_id, which the caller never filters on,
-- so a player filter could not be pushed under it and the plan sorted the
-- whole table — 56,000 rows to return 560, spilling 7.3 MB to disk. That is
-- what ran out the statement timeout in production; the Postgres log said
-- 57014 and the plan said `Sort Method: external merge`.
--
-- Asserting on the absence of the window, because the sort only appears once
-- the table is big enough to exhaust work_mem and this suite's fixture is not.
select unalike(
  pg_get_viewdef('public.player_component_power_history'::regclass, true),
  '%OVER (PARTITION BY%',
  'player_component_power_history counts its board without a window');

select has_index('public', 'player_component_power_snapshots',
  'player_component_power_snapshots_observation_idx',
  'the observation index exists, or board_size scans the table per row');

select * from finish();
rollback;
