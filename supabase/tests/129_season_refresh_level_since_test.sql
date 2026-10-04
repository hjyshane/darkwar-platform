-- 0226: the season board's refresh by index probes. Newest level per building
-- still wins, level_since is the first sighting after the level last changed,
-- an unchanged level keeps the date already on the board, and a full refresh
-- (no players named) still covers everyone.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.players (game_uid, server_id, current_name)
values (850000000101, 580, 'ProbeA'),
       (850000000102, 580, 'ProbeB');

create function pg_temp.pid(p_uid bigint) returns uuid language sql as $$
  select player_id from public.players where game_uid = p_uid;
$$;

-- Sightings relative to now: the level-since window is the last 30 days.
create function pg_temp.sb(key text, uid bigint, btype int, lvl int, days_ago int)
returns void language sql as $$
  insert into public.season_building_snapshots
    (observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, server_id,
     player_id, game_uid, object_id, point_id, x, y, building_type_id, level)
  values
    ('00000000-0000-4000-8000-00000000f852', 'world.get.new', 'test',
     key, now() - make_interval(days => days_ago), '00000000-0000-4000-8000-000000000c01',
     580, 580, pg_temp.pid(uid), uid, uid + btype, 593383, 593, 383, btype, lvl);
$$;

create function pg_temp.since(uid bigint, btype int) returns timestamptz language sql as $$
  select (level_since ->> btype::text)::timestamptz
  from public.player_season_buildings_current where player_id = pg_temp.pid(uid);
$$;

-- Level 5 seen ten and eight days ago, then 6 from five days ago.
select pg_temp.sb('t:probe:1', 850000000101, 859000, 5, 10);
select pg_temp.sb('t:probe:2', 850000000101, 859000, 5, 8);
select pg_temp.sb('t:probe:3', 850000000101, 859000, 6, 5);
-- A second building type, to prove every type is probed.
select pg_temp.sb('t:probe:4', 850000000101, 860000, 3, 2);

select is(
  (select levels from public.player_season_buildings_current
    where player_id = pg_temp.pid(850000000101)),
  '{"859000": 6, "860000": 3}'::jsonb,
  'newest level per building type, every type');

select is(pg_temp.since(850000000101, 859000)::date, (now() - interval '5 days')::date,
  'level_since is when the current level arrived');

-- Another sighting at the same level keeps the date.
select pg_temp.sb('t:probe:5', 850000000101, 859000, 6, 1);
select is(pg_temp.since(850000000101, 859000)::date, (now() - interval '5 days')::date,
  'an unchanged level keeps its date');

-- A late replay of the old level, older than the newest, changes nothing.
select pg_temp.sb('t:probe:6', 850000000101, 859000, 5, 9);
select is(
  (select levels -> '859000' from public.player_season_buildings_current
    where player_id = pg_temp.pid(850000000101)),
  to_jsonb(6),
  'an older sighting does not lower the level');

-- 5 -> 6 -> 5: the second 5 dates from its own arrival, not the first.
select pg_temp.sb('t:probe:7', 850000000102, 859000, 5, 9);
select pg_temp.sb('t:probe:8', 850000000102, 859000, 6, 6);
select pg_temp.sb('t:probe:9', 850000000102, 859000, 5, 3);
select is(pg_temp.since(850000000102, 859000)::date, (now() - interval '3 days')::date,
  'a level that came back dates from its return');

-- A run older than the window is "longer ago than we look": null.
select pg_temp.sb('t:probe:10', 850000000102, 861000, 7, 40);
select ok(pg_temp.since(850000000102, 861000) is null,
  'a level unchanged for longer than the window has no date');

-- A full refresh still finds every player.
delete from public.player_season_buildings_current
 where player_id in (pg_temp.pid(850000000101), pg_temp.pid(850000000102));
select public.refresh_player_season_buildings(null);
select is(
  (select count(*)::int from public.player_season_buildings_current
    where player_id in (pg_temp.pid(850000000101), pg_temp.pid(850000000102))),
  2,
  'a full refresh covers every player with sightings');

-- 0226 dropped the duplicate of 0149's index.
select ok(to_regclass('public.season_building_member_type_idx') is null,
  'the duplicate index is gone');

select * from finish();
rollback;
