-- 0067: departure is derived, and the derivation has to survive a partial
-- capture.
--
-- Two things are being proven, and the second is the one that matters.
--
-- The easy half: a member absent from the newest al.rank batch is reported
-- as departed, and the views stay behind the member gate (짠20.2).
--
-- The hard half: six of our own alliance's ten batches hold 92 or 93 rows
-- for an alliance the game reports as 94, because the member list was not
-- scrolled to the end. A view that treats "newest batch" as truth calls that
-- a departure. So a batch smaller than `alliances.member_count` must
-- come back with confirmed = false, and the same absence must flip to
-- confirmed = true once a full batch arrives.
--
-- Every assertion runs against rows this file inserts. An is_empty() over an
-- empty table proves nothing, and this repo has shipped two negatives that
-- passed that way for weeks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cd01', 'departure test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'departure-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000f002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'departure-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f001', 'viewer', 'departure viewer'),
  ('00000000-0000-4000-8000-00000000f002', 'member', 'departure member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Three members expected, which is what the game would report as curMember.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, member_count)
values ('00000000-0000-4000-8000-00000000ad01', 580, 'deadbeefdeadbeefdeadbeefdeadbe01',
        'DEPARTURE TEST', 'DEP', 3);

-- An alliance nobody has captured a roster for. 0150 drives both views from
-- `alliances` instead of from the snapshots, so this row is the one that
-- would leak through as a phantom — a member with a null captured_at, or a
-- departure from a batch that does not exist.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, member_count)
values ('00000000-0000-4000-8000-00000000ad02', 580, 'deadbeefdeadbeefdeadbeefdeadbe02',
        'NEVER CAPTURED', 'NIL', 4);

-- Batch one: all three present.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, name, power)
values
  ('00000000-0000-4000-8000-00000000ab01', 'al.rank', 'test', 'test:dep:b1:1',
   '2026-08-01T00:00:00Z', '00000000-0000-4000-8000-00000000cd01', 580,
   '00000000-0000-4000-8000-00000000ad01', 580, 111000580, 'Stays', 100),
  ('00000000-0000-4000-8000-00000000ab02', 'al.rank', 'test', 'test:dep:b1:2',
   '2026-08-01T00:00:00Z', '00000000-0000-4000-8000-00000000cd01', 580,
   '00000000-0000-4000-8000-00000000ad01', 580, 222000580, 'Also stays', 200),
  ('00000000-0000-4000-8000-00000000ab03', 'al.rank', 'test', 'test:dep:b1:3',
   '2026-08-01T00:00:00Z', '00000000-0000-4000-8000-00000000cd01', 580,
   '00000000-0000-4000-8000-00000000ad01', 580, 333000580, 'Leaves', 300);

-- Batch two: two rows. Fewer than member_count says the alliance holds, so
-- this is exactly the shape of the half-scrolled capture.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, name, power)
values
  ('00000000-0000-4000-8000-00000000ab04', 'al.rank', 'test', 'test:dep:b2:1',
   '2026-08-02T00:00:00Z', '00000000-0000-4000-8000-00000000cd01', 580,
   '00000000-0000-4000-8000-00000000ad01', 580, 111000580, 'Stays', 110),
  ('00000000-0000-4000-8000-00000000ab05', 'al.rank', 'test', 'test:dep:b2:2',
   '2026-08-02T00:00:00Z', '00000000-0000-4000-8000-00000000cd01', 580,
   '00000000-0000-4000-8000-00000000ad01', 580, 222000580, 'Also stays', 210);

-- The gate first. 짠20.2: no RLS change ships without the negative.
set local role anon;
select throws_ok($$ select * from public.alliance_roster_latest $$, '42501', null,
  'anon: no roster');
select throws_ok($$ select * from public.alliance_departures $$, '42501', null,
  'anon: no departures');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f001');
select is_empty($$ select * from public.alliance_roster_latest $$,
  'a signed-in viewer sees no roster');
select is_empty($$ select * from public.alliance_departures $$,
  'nor who left it');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f002');

-- The views are SECURITY DEFINER, so this is the assertion that keeps them
-- honest: 0066 restricted the base table to officer/admin or the caller's
-- own linked player, and that restriction must still bite. An unlinked
-- member reads no rows from it directly, and reads the roster only through
-- the view, which exposes one sighting per member and no history.
-- A granted column rather than `*`: 0016's grant is column-list, so `select
-- *` fails at the GRANT with 42501 and never reaches the policy. Asking for
-- captured_at gets past the grant, which is what makes the empty result an
-- assertion about RLS rather than about privileges.
select is_empty($$ select captured_at from public.alliance_member_snapshots $$,
  'a member still cannot read the history table itself (0066 stands)');

-- The roster is the newest batch, not everyone ever seen. This is the whole
-- bug: `players.current_alliance_id` never cleared, so the old roster held
-- three names forever.
select bag_eq(
  $$ select game_uid from public.alliance_roster_latest
     where alliance_id = '00000000-0000-4000-8000-00000000ad01' $$,
  $$ values (111000580::bigint), (222000580::bigint) $$,
  'the roster is the newest batch');

select bag_eq(
  $$ select game_uid from public.alliance_departures
     where alliance_id = '00000000-0000-4000-8000-00000000ad01' $$,
  $$ values (333000580::bigint) $$,
  'the one absent from it is a departure');

-- An alliance with no capture at all is absent, not present-and-empty: both
-- views inner-join their newest batch, and 0150's LATERAL max() returns null
-- for it rather than no row.
select is_empty(
  $$ select game_uid from public.alliance_roster_latest
     where alliance_id = '00000000-0000-4000-8000-00000000ad02' $$,
  'an alliance never captured has no roster rows');
select is_empty(
  $$ select game_uid from public.alliance_departures
     where alliance_id = '00000000-0000-4000-8000-00000000ad02' $$,
  'and nobody has departed it');

-- observed_members counts the NEWEST BATCH, not the history: five rows have
-- been captured for this alliance across two batches, and the newest holds
-- two. Everything snapshot_complete decides rests on that number being the
-- batch rather than the archive.
select is(
  (select distinct observed_members from public.alliance_roster_latest
    where alliance_id = '00000000-0000-4000-8000-00000000ad01'),
  2::bigint, 'observed_members is the size of the newest batch');

-- One row per member, not one per capture. The view is membership, not the
-- time series 0066 closed: 'Stays' was seen in both batches and appears once.
select is(
  (select count(*) from public.alliance_roster_latest where game_uid = 111000580),
  1::bigint, 'the roster carries the newest sighting only, not the history');

-- Last seen state travels with them: a roster that drops the row leaves no
-- way to answer "who was that, and how big were they".
select is(
  (select last_known_name from public.alliance_departures where game_uid = 333000580),
  'Leaves', 'the departure carries the name they were last seen under');
select is(
  (select last_power from public.alliance_departures where game_uid = 333000580),
  300::bigint, 'and the power from that last sighting, not from the newer batch');
select is(
  (select last_seen_in_alliance_at from public.alliance_departures where game_uid = 333000580),
  '2026-08-01T00:00:00Z'::timestamptz, 'and when');

-- THE TRAP. Two of three observed, three expected: this batch did not see
-- the whole list, so the absence is a maybe.
select is(
  (select bool_and(snapshot_complete) from public.alliance_roster_latest
   where alliance_id = '00000000-0000-4000-8000-00000000ad01'),
  false, 'a batch smaller than member_count is not a complete roster');
select is(
  (select confirmed from public.alliance_departures where game_uid = 333000580),
  false, 'so the departure is reported unconfirmed rather than as fact');
reset role;

-- Now the alliance really is two people. The same absence must become a
-- confirmed departure, or the guard has simply replaced a false positive
-- with a permanent false negative.
update public.alliances set member_count = 2
where alliance_id = '00000000-0000-4000-8000-00000000ad01';

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f002');
select is(
  (select confirmed from public.alliance_departures where game_uid = 333000580),
  true, 'a full batch confirms the departure');
reset role;

select * from finish();
rollback;
