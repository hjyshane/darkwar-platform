-- 0112: build_rank_period refuses a member, because a member cannot see the
-- roster it computes from.
--
-- The 0066 policy shows a member only their own alliance_member_snapshots
-- rows, and RLS holds inside SECURITY DEFINER on hosted Supabase (0105). A
-- member call therefore would not error — it would score the whole roster
-- from one player's history and write wrong tiers for everyone else, which
-- is why the refusal has to be the function's own first statement rather
-- than something the screen remembers to check.
--
-- The refusal is asserted through both doors: the function itself, and
-- rebuild_rank_period, whose first statement calls it (0090) — a member must
-- not be able to reach the computation by asking the wrapper instead.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab111', 580, 'ext-gate', 'GateTest', true);
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values ('00000000-0000-4000-8000-0000000ab112', 580, 9110000000000001, 'Gated',
        '00000000-0000-4000-8000-0000000ab111');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ad111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gate-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ad112', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gate-viewer@test.invalid'),
  ('00000000-0000-4000-8000-0000000ad113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gate-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ad111', 'member', 'gate member'),
  ('00000000-0000-4000-8000-0000000ad112', 'viewer', 'gate viewer'),
  ('00000000-0000-4000-8000-0000000ad113', 'officer', 'gate officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- The negative half (§20.2): the roles 0066 narrows are the roles this
-- function refuses.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad111');
select throws_ok(
  $$ select public.build_rank_period('2026-07-27T02:00:00Z') $$,
  '42501', null,
  'a member cannot build a period — 0066 hides the roster history their '
  'computation would need');

select throws_ok(
  $$ select public.rebuild_rank_period('2026-07-27T02:00:00Z', false) $$,
  '42501', null,
  'nor reach the computation through the wrapper');

select pg_temp.act_as('00000000-0000-4000-8000-0000000ad112');
select throws_ok(
  $$ select public.build_rank_period('2026-07-27T02:00:00Z') $$,
  '42501', null, 'a viewer cannot either');

-- And nothing was written on the way to any refusal.
select is(
  (select count(*) from public.rank_period_snapshots
   where period_start = '2026-07-27T02:00:00Z'),
  0::bigint, 'a refused call writes no snapshot rows');

-- The positive half, so the gate is proven to sit between member and
-- officer rather than in front of everybody.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad113');
select lives_ok(
  $$ select public.build_rank_period('2026-07-27T02:00:00Z') $$,
  'an officer can build one');

reset role;

select * from finish();
rollback;
