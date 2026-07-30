-- 0008: identity tables must track the newest snapshot, and name history
-- must accumulate (FR-CORE-001). Each of the four snapshot tables is
-- inserted into for real, so a column that does not exist on one of them
-- fails here rather than on the first live sync.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

create temp table _ids as
select
  (select player_id from public.players where game_uid = 58000001) as player_id,
  (select alliance_id from public.alliances limit 1) as alliance_id;

-- A roster snapshot sets the summary and records the name.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, kills)
select '00000000-0000-4000-8000-00000000e001', 'al.rank', 'test',
       'test:summary:roster:1', '2026-07-28T10:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       i.player_id, 58000001, 'FirstName', 3, 41, 111, 222
from _ids i;

select is((select power from public.players where game_uid = 58000001), 111::bigint,
  'roster snapshot fills the player summary');
select is((select hq_level from public.players where game_uid = 58000001), 41,
  'hq level comes from the snapshot');
select is((select name from public.player_names pn join public.players p using (player_id)
           where p.game_uid = 58000001 and pn.name = 'FirstName'), 'FirstName',
  'the observed name is recorded in history');

-- An OLDER snapshot must not overwrite a newer summary.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, power)
select '00000000-0000-4000-8000-00000000e002', 'al.rank', 'test',
       'test:summary:roster:stale', '2026-07-27T10:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       i.player_id, 58000001, 'StaleName', 999
from _ids i;

select is((select power from public.players where game_uid = 58000001), 111::bigint,
  'a stale snapshot does not overwrite a newer summary');
select isnt_empty(
  $$ select 1 from public.player_names pn join public.players p using (player_id)
     where p.game_uid = 58000001 and pn.name = 'StaleName' $$,
  'but the older name is still kept in history');

-- A ranking snapshot updates the summary without touching membership.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   name, power, rank)
select '00000000-0000-4000-8000-00000000e003', 'server.rank', 'test',
       'test:summary:rank:1', '2026-07-28T11:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.player_id, 580,
       58000001, 'RankName', 333, 1
from _ids i;

select is((select power from public.players where game_uid = 58000001), 333::bigint,
  'a newer ranking snapshot advances the summary');

-- A detail snapshot uses power_total, on a table with no name column.
insert into public.player_detail_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   power_total, power_components, components_sum_matches)
select '00000000-0000-4000-8000-00000000e004', 'get.new.user.info', 'test',
       'test:summary:detail:1', '2026-07-28T12:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.player_id, 580,
       58000001, 444, '{"armyPower": 444}'::jsonb, true
from _ids i;

select is((select power from public.players where game_uid = 58000001), 444::bigint,
  'a detail snapshot advances the summary from power_total');

-- Alliance summary and name history.
insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, external_id,
   name, code, power, member_count)
select '00000000-0000-4000-8000-00000000e005', 'alliance.rank', 'test',
       'test:summary:alliance:1', '2026-07-28T13:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       'ffffffffffffffffffffffffffffff01', 'Renamed', 'RNMD', 555, 77
from _ids i;

select is((select power from public.alliances a join _ids i using (alliance_id)), 555::bigint,
  'alliance snapshot fills the alliance summary');
select isnt_empty(
  $$ select 1 from public.alliance_names an join _ids i using (alliance_id)
     where an.name = 'Renamed' $$,
  'the alliance name is recorded in history');

select * from finish();
rollback;
