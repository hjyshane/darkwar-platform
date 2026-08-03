-- 0066: own-or-officer on alliance_member_snapshots.
--
-- §20.2 asks every RLS change to ship its negative. The negative here is the
-- point of the whole migration: a member opening a teammate's page must get
-- NOTHING, and that has to be proven rather than assumed from reading the
-- policy — a predicate that is accidentally true reads exactly like one that
-- is correctly true.
--
-- Four readers, because they fail differently:
--   1. a linked member sees their own rows and only their own
--   2. an UNLINKED member sees nothing at all, including rows that are
--      arguably "theirs" by name — an account nobody linked is nobody
--   3. an officer sees everyone
--   4. a viewer still sees nothing, which 0065 established and this must
--      not have quietly widened
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   is_super_admin, confirmation_token, recovery_token)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated',
  'authenticated', u.email, '', now(), now(), now(), '{}', '{}',
  false, '', ''
from (values
  ('00000000-0000-4000-8000-00000000e001'::uuid, 'mh-linked@test.invalid'),
  ('00000000-0000-4000-8000-00000000e002'::uuid, 'mh-unlinked@test.invalid'),
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'mh-officer@test.invalid'),
  ('00000000-0000-4000-8000-00000000e004'::uuid, 'mh-viewer@test.invalid')
) as u(id, email);

-- Two players and two snapshots, so "sees their own" can be distinguished
-- from "sees everything" — with one row each those two are the same result.
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000a1601', 580, 58019601, 'MineHistory'),
  ('00000000-0000-4000-8000-0000000a1602', 580, 58019602, 'TheirsHistory');

insert into public.alliances (alliance_id, server_id, external_id, current_name)
values ('00000000-0000-4000-8000-0000000a1501', 580, 'ext-mh', 'MHAlliance');

insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-00000000e001', 'member', 'mh linked',
   '00000000-0000-4000-8000-0000000a1601'),
  ('00000000-0000-4000-8000-00000000e002', 'member', 'mh unlinked', null),
  ('00000000-0000-4000-8000-00000000e003', 'officer', 'mh officer', null),
  ('00000000-0000-4000-8000-00000000e004', 'viewer', 'mh viewer', null);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, power)
values
  ('00000000-0000-4000-8000-00000000d201', 'al.rank', 'test', 'test:mh:1',
   '2026-08-01T10:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000a1501', 580,
   '00000000-0000-4000-8000-0000000a1601', 58019601, 'MineHistory', 100),
  ('00000000-0000-4000-8000-00000000d202', 'al.rank', 'test', 'test:mh:2',
   '2026-08-02T10:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000a1501', 580,
   '00000000-0000-4000-8000-0000000a1601', 58019601, 'MineHistory', 120),
  ('00000000-0000-4000-8000-00000000d203', 'al.rank', 'test', 'test:mh:3',
   '2026-08-02T10:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000a1501', 580,
   '00000000-0000-4000-8000-0000000a1602', 58019602, 'TheirsHistory', 900);

select has_column('public', 'app_users', 'player_id',
  'an account can say which player it is');

-- The link is not self-service. This is the assertion the whole design
-- rests on: if a member could write this column they could claim anybody.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'app_users'
      and cmd in ('ALL', 'UPDATE')
      and qual not like '%has_permission%'),
  0, 'every write path on app_users goes through a capability');

-- 1. A linked member: their own rows, and only their own.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.alliance_member_snapshots),
  2, 'a linked member reads their own history');
select is(
  (select count(distinct player_id)::int from public.alliance_member_snapshots),
  1, 'and nobody else appears in it');
select is_empty($$
  select snapshot_id from public.alliance_member_snapshots
   where player_id = '00000000-0000-4000-8000-0000000a1602'
$$, 'a member cannot read a teammate''s history');

-- 2. An unlinked member. Not a smaller result — an empty one.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e002","role":"authenticated"}', true);

select is(public.linked_player_id(), null::uuid,
  'an unlinked account is nobody');
select is_empty($$ select snapshot_id from public.alliance_member_snapshots $$,
  'and reads no history at all, not even rows bearing their name');

-- 3. An officer reads everyone. Enumerated roles, not a comparison: app_role
-- sorts the service roles above admin.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e003","role":"authenticated"}', true);

-- Scoped to this file's own players. The seed carries roster snapshots of
-- its own, so an absolute count here measures the seed rather than the
-- policy — which is the trap 12_month_card_admin_test's comment warns
-- about, and it caught this file on its first CI run.
--
-- The member above was not scoped and did not need to be: their result is
-- empty of everything except their own rows, which is the assertion.
select is(
  (select count(*)::int from public.alliance_member_snapshots
    where player_id in ('00000000-0000-4000-8000-0000000a1601',
                        '00000000-0000-4000-8000-0000000a1602')),
  3, 'an officer reads every member''s history, not only one member''s');
select is(
  (select count(distinct player_id)::int from public.alliance_member_snapshots
    where player_id in ('00000000-0000-4000-8000-0000000a1601',
                        '00000000-0000-4000-8000-0000000a1602')),
  2, 'including the member they are not');

-- The pass column stays admin-only whatever this migration says. 0016's
-- column grant is a different mechanism and must not have been loosened.
select throws_ok(
  'select month_card_expires_at from public.alliance_member_snapshots',
  '42501', null, 'and still cannot read the monthly pass column');

-- 4. A viewer, unchanged from 0065.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000e004","role":"authenticated"}', true);

select is_empty($$ select snapshot_id from public.alliance_member_snapshots $$,
  'a viewer reads none of it');

reset role;

-- anon never reached this table and still does not (0065).
set local role anon;
select throws_ok($$ select snapshot_id from public.alliance_member_snapshots $$,
  '42501', null, 'anon is refused outright rather than filtered');
reset role;

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'alliance_member_snapshots'
      and policyname = 'member_read'),
  0, 'the old blanket member policy is gone, not merely shadowed');

select * from finish();
rollback;
