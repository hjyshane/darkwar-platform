-- 0139: the member × building view shows one row per member per building
-- type, at the newest level, and shows a viewer nothing.
--
-- 0149 added the membership source to what this file pins. The board has now
-- twice been wrong about WHO is a member — 0146 (players.current_alliance_id
-- carried ex-members onto it) and 0149 (alliance_roster_latest recomputed the
-- whole group's roster from 1.76M rows and timed the board out) — so the rule
-- gets a test rather than only a comment: membership is
-- member_roster_current, the same 82 rows the members table reads.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select has_column('public', 'member_season_buildings', c.col,
  'member_season_buildings has ' || c.col)
from unnest(array['player_id', 'building_type_id', 'level']) as c(col);

-- Newest per (member, building type), NOT newest overall: a pan sees part of
-- a member's plot, so one global captured_at would blank whatever that pan
-- happened to miss.
select is(
  (select count(*)::int
     from (select player_id, building_type_id
             from public.member_season_buildings
            group by 1, 2 having count(*) > 1) dupes),
  0,
  'one row per member per building type');

-- Two players with identical buildings; only one of them is on the roster.
insert into public.players (game_uid, server_id, current_name)
values (850000000001, 580, 'SeasonOnRoster'),
       (850000000002, 580, 'SeasonDeparted');

create function pg_temp.pid(p_uid bigint) returns uuid language sql as $$
  select player_id from public.players where game_uid = p_uid;
$$;

insert into public.member_roster_current (player_id)
values (pg_temp.pid(850000000001));

create function pg_temp.sb(key text, uid bigint, lvl int) returns void
language sql as $$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id,
     player_id, game_uid, object_id, point_id, x, y, building_type_id, level)
  values
    ('00000000-0000-4000-8000-00000000f851', 'world.get.new', 'test',
     key, '2026-08-22T09:25:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 580, pg_temp.pid(uid), uid, uid, 593383, 593, 383, 859000, lvl);
$$;

select pg_temp.sb('t:msb:1', 850000000001, 17);
select pg_temp.sb('t:msb:2', 850000000002, 17);

select is(
  (select level from public.member_season_buildings
    where player_id = pg_temp.pid(850000000001) and building_type_id = 859000),
  17,
  'a roster member''s building is on the board');

-- The failure 0146 was written for, now pinned from the other side: a player
-- the roster table does not hold has left, and their plot leaves with them.
select is_empty(
  format($$ select level from public.member_season_buildings
             where player_id = %L $$, pg_temp.pid(850000000002)),
  'a player absent from member_roster_current is not on the board');

-- 0147's fold: the row count is the MEMBER count, which is the only reason a
-- client limit is safe against PostgREST's 1,000-row cap.
select is(
  (select count(*)::int from public.member_season_buildings_by_member),
  (select count(distinct player_id)::int from public.member_season_buildings),
  'the folded view returns one row per member');

-- The view is security_invoker, so a viewer is stopped by the underlying
-- table's own policy rather than by anything written here.
set local role authenticated;
select is_empty(
  $$ select player_id from public.member_season_buildings $$,
  'a request with no member role reads no buildings');
reset role;

set local role anon;
select throws_ok($$ select player_id from public.member_season_buildings $$,
  '42501', null, 'anon reads no member buildings');
reset role;

select * from finish();
rollback;
