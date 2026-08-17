-- 0107: the ranking screens' reads, pinned to the shapes that make them cheap.
--
-- Three assertions of plan and three of machinery. The plan pins are 59's
-- technique: the cross-server board queries filter on source_command / metric
-- and take the newest 300, and without 0107's composite indexes that is a
-- full scan and a sort per board switch — which is exactly what it was in
-- production. The machinery pins mirror 64's, because alliance_latest_current
-- is the same refresh pattern as member_roster_current and the same failure
-- (quietly serving yesterday, or nothing) would be as silent.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-000000660c01', 'boards probe');

-- Enough rows, spread across four commands, that a seq scan and sort is not
-- simply the cheapest honest plan (59's rule — 600 rows was, measured). Two
-- players carry all of them — the board queries never filter by player.
insert into public.players (game_uid, server_id, current_name)
values (660000000001, 580, 'Board1'), (660000000002, 580, 'Board2');

insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, power, rank, raw)
select gen_random_uuid(), (array['server.rank','kill.rank','arena.rank','power.rank'])[1 + g % 4], 1,
       'test:65:ps:' || g, now() - (g || ' seconds')::interval,
       '00000000-0000-4000-8000-000000660c01', 580,
       (select player_id from public.players where game_uid = 660000000001 + g % 2),
       580, 660000000001 + g % 2, 1000 * g, 1 + g % 150, '{}'::jsonb
from generate_series(1, 6000) g;

insert into public.player_component_power_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   metric, power, rank, raw)
select gen_random_uuid(), 'rank.get.by.range', 1,
       'test:65:pc:' || g, now() - (g || ' seconds')::interval,
       '00000000-0000-4000-8000-000000660c01', 580, null, 580,
       660000000000 + g,
       (array['hero_power_total','pet_power_total','hero_power_best','pet_power_best'])[1 + g % 4],
       1000 * g, 1 + g % 150, '{}'::jsonb
from generate_series(1, 6000) g;

analyze public.player_snapshots;
analyze public.player_component_power_snapshots;

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

-- 1-2. The board reads go through the composite indexes. Checked red by
-- dropping the 0107 indexes: both plans fall back to a scan plus sort.
select matches(
  pg_temp.plan_for(
    'select snapshot_id from public.player_snapshots ' ||
    'where source_command = ''server.rank'' ' ||
    'order by captured_at desc, rank limit 300'),
  'player_snapshots_command_captured_idx',
  'a cross-server board reads the newest 300 through the command index');

select matches(
  pg_temp.plan_for(
    'select snapshot_id from public.player_component_power_snapshots ' ||
    'where metric = ''hero_power_total'' ' ||
    'order by captured_at desc, rank limit 300'),
  'player_component_power_metric_captured_idx',
  'a component board reads the newest 300 through the metric index');

-- 3-6. The alliance summary machinery, in miniature: the snapshot insert
-- itself fills the table, the newest capture wins, a vanished alliance is
-- pruned, and the view reads the table.
insert into public.alliances (server_id, external_id, current_name) values
  (580, 'boards-al-65', 'BoardsProbe');

insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, external_id,
   name, power, member_count, raw)
select gen_random_uuid(), 'alliance.rank', 1, 'test:65:as:' || v.key,
       v.at::timestamptz, '00000000-0000-4000-8000-000000660c01', 580,
       a.alliance_id, 580, v.ext, v.nm, v.power, 90, '{}'::jsonb
from public.alliances a,
     (values ('1', 'boards-ext-A', 'OldName', 1000::bigint, '2026-08-08T10:00:00Z'),
             ('2', 'boards-ext-A', 'NewName', 2000::bigint, '2026-08-09T10:00:00Z'),
             ('3', 'boards-ext-B', 'Gone',    500::bigint,  '2026-08-08T10:00:00Z')) as v(key, ext, nm, power, at)
where a.external_id = 'boards-al-65';

select is(
  (select count(*) from public.alliance_latest_current
    where external_id like 'boards-ext-%'),
  2::bigint, 'the snapshot insert itself filled the summary, one row per alliance');

select is(
  (select name from public.alliance_latest_current where external_id = 'boards-ext-A'),
  'NewName', 'the newest capture wins');

-- A later batch that no longer carries B: B''s newest row is still its old
-- one, so B SURVIVES — alliance_latest keeps every alliance''s newest
-- snapshot, not only the alliances in the last batch. That is the view''s
-- original DISTINCT ON semantic, and the prune must not break it.
insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, external_id,
   name, power, member_count, raw)
select gen_random_uuid(), 'alliance.rank', 1, 'test:65:as:4',
       '2026-08-09T12:00:00Z', '00000000-0000-4000-8000-000000660c01', 580,
       a.alliance_id, 580, 'boards-ext-A', 'NewerStill', 3000, 90, '{}'::jsonb
from public.alliances a where a.external_id = 'boards-al-65';

select is(
  (select count(*) from public.alliance_latest_current
    where external_id like 'boards-ext-%'),
  2::bigint, 'an alliance absent from the newest batch keeps its newest snapshot');

select is(
  (select name from public.alliance_latest ali where ali.external_id = 'boards-ext-A'),
  'NewerStill', 'and the view reads the refreshed table');

-- 7. anon cannot call the refresh.
--
-- The signature gained an argument in 0128 — the refresh now takes the external
-- ids to recompute, so that a write no longer rebuilds the whole table. This
-- assertion takes an EXACT signature, defaults do not apply to it, and the
-- zero-argument form no longer exists. The thing being asserted is unchanged.
select ok(
  not has_function_privilege('anon', 'public.refresh_alliance_latest(text[])', 'execute'),
  'anon may not call the refresh');

-- 8. The view stayed invoker — the table''s RLS is the boundary.
select is_empty(
  $$ select c.relname from pg_class c
      where c.oid = 'public.alliance_latest'::regclass
        and (c.reloptions is null
             or c.reloptions::text !~ 'security_invoker=(true|on)') $$,
  'alliance_latest reads with the caller''s rights');

select * from finish();
rollback;
