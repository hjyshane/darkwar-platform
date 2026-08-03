-- 0016: the monthly pass is admin-only, proven at every door it used to be
-- open at (§20.2: every policy ships with its negative).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Personas: a member and an admin.
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
  ('00000000-0000-4000-8000-00000000f102'::uuid, 'mc-member@test.local'),
  ('00000000-0000-4000-8000-00000000f104'::uuid, 'mc-admin@test.local')
) as u(id, email);

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-00000000f102', 'member'),
  ('00000000-0000-4000-8000-00000000f104', 'admin');

-- A pass reaches the secured table through the summary trigger.
-- Its own rows. These assertions are absolute values on specific
-- players, and borrowing seeded ones means the file stops working the
-- moment somebody loads real captures and clears the seed.
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000ad601', 580, 58009601, 'MonthAdminOnly');
insert into public.alliances (alliance_id, server_id, external_id, current_name)
values ('00000000-0000-4000-8000-0000000ad501', 580, 'ext-month-admin', 'MonthAdminAlliance');

create temp table _ids as
select '00000000-0000-4000-8000-0000000ad601'::uuid as player_id,
       '00000000-0000-4000-8000-0000000ad501'::uuid as alliance_id;

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, month_card_expires_at)
select '00000000-0000-4000-8000-00000000d101', 'al.rank', 'test',
       'test:mc:1', '2026-07-28T10:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       i.player_id, 58009601, 'Holder', '2026-08-25T02:00:00Z'
from _ids i;

select isnt_empty($$ select player_id from public.player_month_cards $$,
  'the trigger routed the pass into the secured table');

-- anon: the summary table is empty, the snapshot columns are gone.
set local role anon;
select is_empty($$ select player_id from public.player_month_cards $$,
  'anon sees no month cards');
select throws_ok('select month_card_expires_at from public.player_snapshots',
  '42501', null, 'anon cannot select the pass column on player_snapshots');
select throws_ok('select raw from public.player_snapshots',
  '42501', null, 'anon cannot select raw on player_snapshots — the pass rides in it');
select lives_ok('select snapshot_id, name, power, kills, rank from public.player_snapshots',
  'the public ranking columns still read fine');
reset role;

-- member: may see the roster, may NOT see who pays.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f102","role":"authenticated"}',
  true);
select is_empty($$ select player_id from public.player_month_cards $$,
  'member sees no month cards');
select throws_ok('select month_card_expires_at from public.alliance_member_snapshots',
  '42501', null, 'member cannot select the pass column on the roster snapshots');
select throws_ok('select raw from public.alliance_member_snapshots',
  '42501', null, 'member cannot select roster raw — the pass rides in it');
select isnt_empty($$ select snapshot_id, name from public.alliance_member_snapshots $$,
  'member still reads the roster itself');

-- admin: the secured table answers.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f104","role":"authenticated"}',
  true);
select isnt_empty($$ select player_id from public.player_month_cards $$,
  'admin reads month cards');
-- Scoped to the row this test created: the table also holds live data,
-- and an unscoped limit 1 grabs whoever sorts first. Resolved through
-- players (readable by this role) because the temp table belongs to
-- postgres and the persona cannot see it.
select is((select m.expires_at from public.player_month_cards m
           where m.player_id = (select player_id from public.players
                                where game_uid = 58009601)),
  '2026-08-25T02:00:00Z'::timestamptz, 'and gets the real expiry');
select throws_ok('select raw from public.player_snapshots',
  '42501', null,
  'even admin reads raw through service tooling, not the client role');
reset role;

select * from finish();
rollback;
