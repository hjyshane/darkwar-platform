-- 0317: a player's squad power. A member reads it, a signed-in stranger and the
-- community role do not, a player is ONE row however many squads and sightings
-- they have, and the newest reading of each squad wins.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sq-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sq-stranger@test.invalid'),
  ('00000000-0000-4000-8000-00000000f303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sq-community@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'sq member'),
  ('00000000-0000-4000-8000-00000000f303', 'community', 'sq community');
-- f302 has no app_users row: signed in, but nobody the app knows.

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f001', 'squad-test');
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-00000000f201', 580, 9710000000000580, 'Squad Owner');

create function pg_temp.squad(p_key text, p_uid bigint, p_squad int, p_power bigint,
                              p_at timestamptz, p_server int default 580)
returns void language sql as $$
  insert into public.player_squad_power_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, squad_no, power, heroes,
     truck_uuid)
  values (gen_random_uuid(), 'train.list', 't', p_key, p_at,
          '00000000-0000-4000-8000-00000000f001', 580, p_server, p_uid, p_squad, p_power,
          jsonb_build_array(jsonb_build_object('slot', 1, 'hero_id', 40002, 'power', 10037900)),
          '777');
$$;

-- Squad Owner: squad 1 seen twice (the newer one is stronger), squad 3 once.
select pg_temp.squad('s:1:old', 9710000000000580, 1, 1700000000, now() - interval '2 days');
select pg_temp.squad('s:1:new', 9710000000000580, 1, 1766291942, now() - interval '1 hour');
select pg_temp.squad('s:3', 9710000000000580, 3, 900000000, now() - interval '3 hours');
-- A stranger to the players table, on another server, with one squad.
select pg_temp.squad('o:2', 9710000000000999, 2, 120000000, now(), 568);

select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;

select is((select count(*)::int from public.player_squads_latest), 2,
  'three squads and four sightings of one player, plus one other: two rows, one per player');
select is((select squad_count from public.player_squads_latest where game_uid = 9710000000000580), 2,
  'the player holds two squads, not three: squad 1 was seen twice');
select is(
  (select (squads -> '1' ->> 'power')::bigint from public.player_squads_latest
    where game_uid = 9710000000000580),
  1766291942::bigint, 'the newest reading of a squad wins');
select is(
  (select (squads -> '3' ->> 'power')::bigint from public.player_squads_latest
    where game_uid = 9710000000000580),
  900000000::bigint, 'and a squad seen once is kept');
select ok((select not (squads ? '2') from public.player_squads_latest
            where game_uid = 9710000000000580),
  'a squad never seen is absent, not zero');
select is(
  (select squads -> '1' -> 'heroes' -> 0 ->> 'hero_id' from public.player_squads_latest
    where game_uid = 9710000000000580),
  '40002', 'the heroes travel with the squad');
select is((select player_name from public.player_squads_latest where game_uid = 9710000000000580),
  'Squad Owner', 'the name comes from players');
select ok((select player_name is null from public.player_squads_latest
            where game_uid = 9710000000000999),
  'someone only ever seen on a truck has no name, and still has a row');
select is((select server_id from public.player_squads_latest where game_uid = 9710000000000999),
  568, 'the owner''s server is kept, not the one it was captured from');
select ok((select seen_at > now() - interval '2 hours' from public.player_squads_latest
            where game_uid = 9710000000000580),
  'the row''s seen_at is the newest of its squads');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
set local role authenticated;
select is((select count(*)::int from public.player_squad_power_snapshots), 0,
  'a user with no role reads no squads');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f303');
set local role authenticated;
select is((select count(*)::int from public.player_squad_power_snapshots), 0,
  'the community role reads none either: it is another alliance''s strength');
select is((select count(*)::int from public.player_squads_latest), 0,
  'nor through the view');

reset role;
select ok(not has_table_privilege('anon', 'public.player_squad_power_snapshots', 'select')
          and not has_table_privilege('anon', 'public.player_squads_latest', 'select'),
  'anon reads neither the table nor the view');

select * from finish();
rollback;
