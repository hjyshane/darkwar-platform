-- 0064: the arena behind the member gate.
--
-- The §20.2 negative, and the four-table version of it. The failure this
-- guards against is not "the arena is readable" — it is "three of the four
-- arena tables are closed and the fourth still answers", which looks shut
-- from the dashboard and is not.
--
-- Every assertion runs against rows this file inserts. An is_empty() over a
-- table with nothing in it proves nothing, and this repo has already shipped
-- two negatives that passed that way for weeks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cb01', 'arena gate test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'arena-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'arena-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e001', 'viewer', 'arena viewer'),
  ('00000000-0000-4000-8000-00000000e002', 'member', 'arena member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- One row in each of the four tables, so no negative below can be vacuous.
insert into public.arena_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, week_start, entry_count, league)
values
  ('00000000-0000-4000-8000-00000000eb01', 'user.get.arena.info', 'test',
   'test:gate:header', '2026-07-27T23:40:00Z',
   '00000000-0000-4000-8000-00000000cb01', 580, 580,
   public.reset_week_start('2026-07-27T23:40:00Z'::timestamptz), 1, 1);

insert into public.arena_entries
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
   captured_at, collector_id, collected_from_server_id, arena_snapshot_id,
   server_id, game_uid, rank, score, defense_power)
select '00000000-0000-4000-8000-00000000eb02', '00000000-0000-4000-8000-00000000eb02',
       'user.get.arena.info', 'test', 'test:gate:entry', '2026-07-27T23:40:00Z',
       '00000000-0000-4000-8000-00000000cb01', 580, snapshot_id, 580, 58009903, 1,
       1500, 400000000
from public.arena_snapshots where idempotency_key = 'test:gate:header';

insert into public.arena_entry_heroes
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, arena_entry_id, server_id, game_uid,
   hero_id, slot, level_synced)
values
  ('00000000-0000-4000-8000-00000000eb03', 'user.get.arena.info', 'test',
   'test:gate:hero', '2026-07-27T23:40:00Z',
   '00000000-0000-4000-8000-00000000cb01', 580,
   '00000000-0000-4000-8000-00000000eb02', 580, 58009903, 40001, 1, false);

insert into public.arena_matches
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, week_start, game_uid)
values
  ('00000000-0000-4000-8000-00000000eb04', 'user.get.arena.info', 'test',
   'test:gate:match', '2026-07-27T23:40:00Z',
   '00000000-0000-4000-8000-00000000cb01', 580, 580,
   public.reset_week_start('2026-07-27T23:40:00Z'::timestamptz), 58009903);

-- The rows are really there. Everything below is a claim about who can see
-- them, and this is what makes those claims mean something.
select isnt_empty($$ select * from public.arena_entry_heroes $$,
  'the lineup row exists when read as the owner');

-- anon: all four closed. 0064 filtered the rows away with a policy; 0065
-- took the grant as well, so the answer is now a refusal rather than an
-- empty list. Both are correct outcomes and only one of them can be
-- produced by an empty table, which is why this asserts the refusal.
set local role anon;
select throws_ok($$ select * from public.arena_snapshots $$, '42501', null, 'anon: no boards');
select throws_ok($$ select * from public.arena_entries $$, '42501', null, 'anon: no entries');
select throws_ok($$ select * from public.arena_entry_heroes $$, '42501', null, 'anon: no lineups');
select throws_ok($$ select * from public.arena_matches $$, '42501', null, 'anon: no matches');
reset role;

-- A signed-in viewer is not a member. Signing in is not the gate.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
select is_empty($$ select * from public.arena_entries $$,
  'a signed-in viewer sees no more than anon');
select is_empty($$ select * from public.arena_entry_heroes $$,
  'including the lineups');
select is(public.has_permission('arena.view'), false,
  'and is not offered the tab');
reset role;

-- A member gets the board back. A gate that closes on everyone is not a
-- gate, it is an outage.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e002');
select isnt_empty($$ select * from public.arena_entries $$,
  'a member reads the board');
select isnt_empty($$ select * from public.arena_entry_heroes $$,
  'and the lineups on it');
select is(public.has_permission('arena.view'), true,
  'and is offered the tab');
reset role;

-- The tab is not the boundary. Revoking arena.view must not be mistaken for
-- closing the data, and granting it must not be mistaken for opening it:
-- the policies are on the tables, and this proves the two are independent.
update public.role_permissions set allowed = true
where role = 'viewer' and capability = 'arena.view';

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
select is_empty($$ select * from public.arena_entry_heroes $$,
  'a viewer given the tab still reads no lineups — RLS is the boundary');
reset role;

select * from finish();
rollback;
