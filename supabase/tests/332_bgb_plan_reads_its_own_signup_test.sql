-- 0332: a Black Gold plan reads its own alliance's signup list, not whichever
-- alliance on the same server opened the signup screen last.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures: two own alliances on server 580. Ours (a1, the primary: lowest
-- id) has Ann and Ben on its roster; theirs (a2) has Eve and Fay. Readings:
--   12:00  ours    Ann, Ben starters of A
--   13:00  theirs  Eve, Fay starters of A, and Ann (who moved over after our
--                  roster was read) — one of three is ours, not a majority
-- Later, 14:00 ours again with Gus, who joined after our roster was read.

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own) values
  ('00000000-0000-4000-8000-0000003320a1', 580, 'ext-332-ours', 'BgbOurs332', true),
  ('00000000-0000-4000-8000-0000003320a2', 580, 'ext-332-theirs', 'BgbTheirs332', true);
-- Pinned, so the primary (and the alliance a new plan lands in) is this
-- fixture's, whatever else in the database is marked own.
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000003320a1", "00000000-0000-4000-8000-0000003320a2"]}');
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-0000003320b1', 580, 9332000000000001, 'Ann', 90),
  ('00000000-0000-4000-8000-0000003320b2', 580, 9332000000000002, 'Ben', 80),
  ('00000000-0000-4000-8000-0000003320b5', 580, 9332000000000005, 'Eve', 70),
  ('00000000-0000-4000-8000-0000003320b6', 580, 9332000000000006, 'Fay', 60),
  ('00000000-0000-4000-8000-0000003320b7', 580, 9332000000000007, 'Gus', 50);

-- One captured_at per roster batch.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id, game_uid, name)
select '00000000-0000-4000-8000-00000000f320', 'al.rank', 'test', 't:332:roster:' || r.uid,
       '2026-11-16T11:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
       r.alliance_id::uuid, 580, p.player_id, p.game_uid, p.current_name
  from (values ('00000000-0000-4000-8000-0000003320a1', 9332000000000001),
               ('00000000-0000-4000-8000-0000003320a1', 9332000000000002),
               ('00000000-0000-4000-8000-0000003320a2', 9332000000000005),
               ('00000000-0000-4000-8000-0000003320a2', 9332000000000006)) as r(alliance_id, uid)
  join public.players p on p.game_uid = r.uid;

create function pg_temp.reading(at text, uid bigint, st int, team int) returns void
language sql as $$
  insert into public.black_money_signup_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid, name,
     power, state, team_index)
  select gen_random_uuid(), 'dragon.assign.player.info', 'test', 't:332:' || at || ':' || uid,
         at::timestamptz, '00000000-0000-4000-8000-000000000c01', 580, 580,
         p.player_id, p.game_uid, p.current_name, p.power, st, team
    from public.players p where p.game_uid = uid;
$$;

select pg_temp.reading('2026-11-16T12:00:00Z', 9332000000000001, 1, 1);
select pg_temp.reading('2026-11-16T12:00:00Z', 9332000000000002, 1, 1);
select pg_temp.reading('2026-11-16T13:00:00Z', 9332000000000005, 1, 1);
select pg_temp.reading('2026-11-16T13:00:00Z', 9332000000000006, 1, 1);
select pg_temp.reading('2026-11-16T13:00:00Z', 9332000000000001, 2, 1);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000003320c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bgb332-member@test.invalid'),
  ('00000000-0000-4000-8000-0000003320c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bgb332-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000003320c4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bgb332-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000003320c2', 'member', 'bgb332 member', null),
  ('00000000-0000-4000-8000-0000003320c3', 'officer', 'bgb332 officer', null),
  ('00000000-0000-4000-8000-0000003320c4', 'viewer', 'bgb332 viewer', null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.bgb_plans (plan_id, alliance_id, team_index, name)
values ('00000000-0000-4000-8000-0000003320d1', '00000000-0000-4000-8000-0000003320a1', 1, 'Ours A');

-- ---------------------------------------------------------------------------
-- Which reading is whose.

select is(internal.bgb_signup_read_at('00000000-0000-4000-8000-0000003320a1'),
  '2026-11-16T12:00:00Z'::timestamptz,
  'our newest reading is ours, though another alliance on the server read later');
select is(internal.bgb_signup_read_at('00000000-0000-4000-8000-0000003320a2'),
  '2026-11-16T13:00:00Z'::timestamptz,
  'and theirs is theirs, though it names one of our players');

-- ---------------------------------------------------------------------------
-- What the panel reads.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003320c2');
select is(public.bgb_starters(1) ->> 'read_at',
  (select to_jsonb('2026-11-16T12:00:00Z'::timestamptz) #>> '{}'),
  'a member is shown when our list was read');
select is((select array_agg(e ->> 'name' order by (e ->> 'power')::bigint desc)
             from jsonb_array_elements(public.bgb_starters(1) -> 'starters') e),
  array['Ann', 'Ben'], 'and our starters of team A, strongest first — not theirs');
select is(jsonb_array_length(public.bgb_starters(2) -> 'starters'), 0,
  'a team nobody is on is an empty list');
select isnt(public.bgb_starters(2) ->> 'read_at', null,
  'with the reading time still given');

select pg_temp.act_as('00000000-0000-4000-8000-0000003320c4');
select throws_ok($$ select public.bgb_starters(1) $$, '42501', null,
  'a viewer cannot read the signup list through it');
reset role;

set local role anon;
select throws_ok($$ select public.bgb_starters(1) $$, '42501', null,
  'nor can anyone signed out');
reset role;

-- ---------------------------------------------------------------------------
-- The save judges against the same reading.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003320c3');
select lives_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003320d1', 1, null, null,
       '[{"objective_key":"factory","player_id":"00000000-0000-4000-8000-0000003320b2","role":"","ordinal":0}]'::jsonb) $$,
  'our starter is placeable, though the server''s newest reading is theirs');
select throws_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003320d1', 2, null, null,
       '[{"objective_key":"factory","player_id":"00000000-0000-4000-8000-0000003320b5","role":"","ordinal":0}]'::jsonb) $$,
  '22023', null, 'their starter is refused');
reset role;

-- A newer reading of ours with a member who joined after the roster was read.
select pg_temp.reading('2026-11-16T14:00:00Z', 9332000000000001, 1, 1);
select pg_temp.reading('2026-11-16T14:00:00Z', 9332000000000002, 1, 1);
select pg_temp.reading('2026-11-16T14:00:00Z', 9332000000000007, 1, 1);

select is(internal.bgb_signup_read_at('00000000-0000-4000-8000-0000003320a1'),
  '2026-11-16T14:00:00Z'::timestamptz, 'a newer reading of ours takes over');
select is(internal.bgb_signup_read_at('00000000-0000-4000-8000-0000003320a2'),
  '2026-11-16T13:00:00Z'::timestamptz, 'and does not become theirs');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003320c3');
select lives_ok(
  $$ select public.save_bgb_plan('00000000-0000-4000-8000-0000003320d1', 2, null, null,
       '[{"objective_key":"factory","player_id":"00000000-0000-4000-8000-0000003320b7","role":"","ordinal":0}]'::jsonb) $$,
  'a starter who joined after the roster was read is still placeable');
reset role;

-- With no roster at all there is no way to say a reading is ours.
select is(internal.bgb_signup_read_at('00000000-0000-4000-8000-0000003310ff'), null,
  'an alliance with no roster has no reading');

select * from finish();
rollback;
