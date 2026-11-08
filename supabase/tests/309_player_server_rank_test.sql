-- 0309: rank on the server with both neighbours, one row.
--
-- A fresh server so no other fixture's players can sit between ours. Five
-- players: a clear leader, a tie for second, a last place, and one with no
-- power reading at all.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.servers (server_id, server_group) values (5990, 'test');

insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-00000000c901', 5990, 59900001, 'Leader', 500),
  ('00000000-0000-4000-8000-00000000c902', 5990, 59900002, 'Tie A', 400),
  ('00000000-0000-4000-8000-00000000c903', 5990, 59900003, 'Tie B', 400),
  ('00000000-0000-4000-8000-00000000c904', 5990, 59900004, 'Last', 100),
  ('00000000-0000-4000-8000-00000000c905', 5990, 59900005, 'Unread', null);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f309', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rank-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000f310', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rank-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f309', 'viewer', 'rank viewer'),
  ('00000000-0000-4000-8000-00000000f310', 'member', 'rank member');
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ------------------------------------------------------------------ the row
select results_eq(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c901') $$,
  $$ values (1, 4, 500::bigint, null::bigint, 400::bigint) $$,
  'rank 1 has no neighbour above and the runner-up below');

select results_eq(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c902') $$,
  $$ values (2, 4, 400::bigint, 500::bigint, 100::bigint) $$,
  'a tie shares the better place; the neighbour below is the next DISTINCT power');

select results_eq(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c904') $$,
  $$ values (4, 4, 100::bigint, 400::bigint, null::bigint) $$,
  'last place has nobody below');

select is_empty(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c905') $$,
  'a player with no power reading has no rank');

select is_empty(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c9ff') $$,
  'an unknown player has no rank');

-- ------------------------------------------------------------ who may read
select ok(
  not (select prosecdef from pg_proc
        where proname = 'player_server_rank'
          and pronamespace = 'public'::regnamespace),
  'invoker, so it can never show more than players itself does');

select ok(
  not has_function_privilege('public', 'public.player_server_rank(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.player_server_rank(uuid)', 'execute'),
  'neither PUBLIC nor anon may execute it (0168: anon holds nothing in public)');

-- 0065: players is member_read. A signed-in viewer is filtered to nothing by
-- the table, so the function — invoker — has nothing to rank. Not an error:
-- the same empty answer a direct read of players gives them.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f309');
select is_empty(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c902') $$,
  'a viewer gets no row, exactly as players shows them none');

select pg_temp.act_as('00000000-0000-4000-8000-00000000f310');
select results_eq(
  $$ select * from public.player_server_rank('00000000-0000-4000-8000-00000000c902') $$,
  $$ values (2, 4, 400::bigint, 500::bigint, 100::bigint) $$,
  'a member reads the row');
reset role;

select * from finish();
rollback;
