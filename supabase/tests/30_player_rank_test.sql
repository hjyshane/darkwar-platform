-- 0057: an admin may set a member's rank, and may not use that to set
-- anything else.
--
-- The second half is the point. RLS decides which ROWS a statement touches
-- and has nothing to say about which COLUMNS, so an update policy on
-- players would have let whoever can set a rank also rewrite power, kills
-- and the alliance link — silently, because a policy that permits the row
-- permits the whole row. The column-level GRANT is what constrains it, and
-- a test that only proved "the rank saves" would have passed either way.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000cd001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rank-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000cd002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rank-plain@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000cd001', 'admin', 'rank admin'),
  ('00000000-0000-4000-8000-0000000cd002', 'member', 'rank plain');

insert into public.players (player_id, server_id, game_uid, current_name, power)
values ('00000000-0000-4000-8000-0000000cd101', 580, 9100000000000009, 'Rankable', 12345);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

select is((select assigned_rank from public.player_ranks
           where player_id = '00000000-0000-4000-8000-0000000cd101'), null,
  'a member arrives with no rank set — the computed one stands until somebody decides');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000cd002');
select throws_ok(
  $$ insert into public.player_ranks (player_id, assigned_rank)
     values ('00000000-0000-4000-8000-0000000cd101', 'R5') $$,
  '42501', null, 'an ordinary member cannot set one');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000cd001');
select lives_ok(
  $$ insert into public.player_ranks (player_id, assigned_rank)
     values ('00000000-0000-4000-8000-0000000cd101', 'R4') $$,
  'somebody who may manage members can');
select is((select assigned_rank from public.player_ranks
           where player_id = '00000000-0000-4000-8000-0000000cd101'), 'R4',
  'and it sticks');

-- The rank lives on its own table so that a policy can hold it. Setting one
-- must not be a way into the world-readable players row it points at.
select throws_ok(
  $$ update public.players set power = 999
      where player_id = '00000000-0000-4000-8000-0000000cd101' $$,
  '42501', null,
  'and setting a rank is not a way to rewrite the player it belongs to');
reset role;

select is((select power from public.players
           where player_id = '00000000-0000-4000-8000-0000000cd101'), 12345::bigint,
  'so the power the collector observed is still the collector''s');

-- 0059: the whole rank is member-only, both halves of it. It used to be
-- half and half — the hand-set rank sat on world-readable `players` while
-- the computed tier stayed member-only, so a logged-out reader saw a rank
-- for the few members somebody had set by hand and a blank for the rest,
-- with nothing on screen to say why. Every figure a rank is derived from is
-- member-only; the conclusion cannot be looser than its inputs.
set local role anon;
select throws_ok(
  $$ select count(*) from public.player_current_rank $$,
  '42501', null, 'a logged-out reader cannot see ranks at all');
reset role;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000cd003', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rank-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000cd003', 'viewer', 'rank viewer');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000cd003');
select is((select count(*) from public.player_current_rank), 0::bigint,
  'and a signed-in viewer sees none either — a rank is alliance business');
reset role;

select * from finish();
rollback;
