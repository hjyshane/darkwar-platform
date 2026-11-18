-- 0333: join_roster. A signed-in viewer reads the current members' names of
-- our own alliances — and nothing more; anon reads nothing at all (§20.2).
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, is_own) values
  ('00000000-0000-4000-8000-0000003330a1', 580, 'ext-332', 'JoinOurs', 'JOIN', true),
  ('00000000-0000-4000-8000-0000003330a2', 580, 'ext-332-x', 'Stranger', 'STRG', false);
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000003330b1', 580, 9332000000000001, 'Ann'),
  ('00000000-0000-4000-8000-0000003330b2', 580, 9332000000000002, 'Ben'),
  ('00000000-0000-4000-8000-0000003330b3', 580, 9332000000000003, 'Gone'),
  ('00000000-0000-4000-8000-0000003330b4', 580, 9332000000000004, 'Outsider');

-- Older roster had Gone; the newest (one captured_at) has Ann and Ben. The
-- stranger alliance's roster has Outsider.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id, game_uid, name)
values
  ('00000000-0000-4000-8000-0000003330e1', 'al.rank', 'test', 't:332:old', '2026-11-10T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, '00000000-0000-4000-8000-0000003330a1', 580,
   '00000000-0000-4000-8000-0000003330b3', 9332000000000003, 'Gone'),
  ('00000000-0000-4000-8000-0000003330e2', 'al.rank', 'test', 't:332:new:1', '2026-11-17T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, '00000000-0000-4000-8000-0000003330a1', 580,
   '00000000-0000-4000-8000-0000003330b1', 9332000000000001, 'Ann'),
  ('00000000-0000-4000-8000-0000003330e2', 'al.rank', 'test', 't:332:new:2', '2026-11-17T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, '00000000-0000-4000-8000-0000003330a1', 580,
   '00000000-0000-4000-8000-0000003330b2', 9332000000000002, 'Ben'),
  ('00000000-0000-4000-8000-0000003330e3', 'al.rank', 'test', 't:332:strg', '2026-11-17T10:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, '00000000-0000-4000-8000-0000003330a2', 580,
   '00000000-0000-4000-8000-0000003330b4', 9332000000000004, 'Outsider');

-- A roster write can re-derive is_own from what the collector has seen
-- (0192's resolve_own_alliance), so state it after the fixtures.
update public.alliances set is_own = (alliance_id = '00000000-0000-4000-8000-0000003330a1')
 where alliance_id in ('00000000-0000-4000-8000-0000003330a1', '00000000-0000-4000-8000-0000003330a2');
select is((select is_own from public.alliances where alliance_id = '00000000-0000-4000-8000-0000003330a2'),
  false, 'fixture: the stranger alliance is not ours');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000003330c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'join-viewer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000003330c1', 'viewer');

select has_function('public', 'join_roster', array['uuid']);
select is(has_function_privilege('anon', 'public.join_roster(uuid)', 'execute'), false,
  'anon cannot call join_roster');

-- A viewer still cannot read players directly (0065) ...
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000003330c1","role":"authenticated"}';
select is((select count(*)::int from public.players
            where player_id = '00000000-0000-4000-8000-0000003330b1'),
  0, 'a viewer still cannot read players directly');

-- ... but reads our current roster through the function.
select is(
  (select array_agg(name order by name) from public.join_roster(null)
    where alliance_id = '00000000-0000-4000-8000-0000003330a1'),
  array['Ann', 'Ben'],
  'a viewer sees the newest roster of our alliance');
select is(
  (select count(*)::int from public.join_roster(null) where name = 'Gone'),
  0, 'not somebody from an older roster');
select is(
  (select count(*)::int from public.join_roster(null) where name = 'Outsider'),
  0, 'not another alliance''s members');
select is(
  (select alliance_code from public.join_roster('00000000-0000-4000-8000-0000003330a1') limit 1),
  'JOIN', 'filtered by the chosen alliance, with its code');
select is(
  (select game_uid from public.join_roster(null) where name = 'Ann'),
  9332000000000001::bigint, 'with the game uid, for typing it instead');
reset role;

-- Signed out: refused even if the grant were there.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select * from public.join_roster(null) $$, '42501', null,
  'no signed-in user, no roster');
reset role;

select * from finish();
rollback;
