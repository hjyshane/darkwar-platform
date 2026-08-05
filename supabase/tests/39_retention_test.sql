-- 0070: retention keeps ours and lets strangers age out — and never touches
-- anything a person typed.
--
-- The assertions that matter are the ones about what SURVIVES. A retention bug
-- that deletes too little wastes storage; one that deletes too much destroys
-- the only copy. So: an assigned rank must still be there afterwards, a
-- departed member's history must still be there, and an arena board with one
-- of our members on it must not be taken away by a cascade.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf01', 'retention test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ret-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ret-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', 'admin', 'ret admin'),
  ('00000000-0000-4000-8000-0000000000e2', 'member', 'ret member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Our alliance and a stranger's.
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-0000000000aa'::uuid, 580, 'aaaa0000000000000000000000000001', 'OURS', true, 2),
  ('00000000-0000-4000-8000-0000000000bb'::uuid, 581, 'bbbb0000000000000000000000000001', 'THEIRS', false, 1);

-- One of ours who left, and a stranger.
insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000000c1'::uuid, 580, 910000580, 'Ours Departed'),
  ('00000000-0000-4000-8000-0000000000c2'::uuid, 581, 920000581, 'A Stranger');

-- A human decision. Nothing about retention may reach this.
insert into public.player_ranks (player_id, assigned_rank)
values ('00000000-0000-4000-8000-0000000000c1', 'R4');

-- What makes the first player ours: a member snapshot of OUR alliance, old
-- enough that "currently a member" would say no.
-- `presence_redacted` is load-bearing here, and getting it wrong is what made
-- the first version of this test fail in a way that looked like a bug in
-- retention. 0031 derives `is_own` from exactly this column: a roster that
-- reports real presence can only be one the collector account belongs to, so
-- an unredacted row silently marks its alliance as ours. Both fixtures had the
-- default of false, and the "stranger" alliance came back is_own = true.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id, name,
   presence_redacted)
values
  ('00000000-0000-4000-8000-0000000000d1', 'al.rank', 'test', 'test:ret:m1',
   now() - interval '40 days', '00000000-0000-4000-8000-00000000cf01', 580,
   '00000000-0000-4000-8000-0000000000aa', 580, 910000580,
   '00000000-0000-4000-8000-0000000000c1', 'Ours Departed', false),
  ('00000000-0000-4000-8000-0000000000d2', 'al.rank', 'test', 'test:ret:m2',
   now() - interval '40 days', '00000000-0000-4000-8000-00000000cf01', 580,
   '00000000-0000-4000-8000-0000000000bb', 581, 920000581,
   '00000000-0000-4000-8000-0000000000c2', 'A Stranger', true);

-- Power readings of the same age for both.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid, player_id, power)
values
  ('00000000-0000-4000-8000-0000000000d3', 'server.rank', 'test', 'test:ret:p1',
   now() - interval '40 days', '00000000-0000-4000-8000-00000000cf01', 580, 580,
   910000580, '00000000-0000-4000-8000-0000000000c1', 500),
  ('00000000-0000-4000-8000-0000000000d4', 'server.rank', 'test', 'test:ret:p2',
   now() - interval '40 days', '00000000-0000-4000-8000-00000000cf01', 580, 581,
   920000581, '00000000-0000-4000-8000-0000000000c2', 600);

-- An old arena board with one of ours on it. Entries cascade from the board,
-- so pruning the board would delete our member's lineup.
insert into public.arena_snapshots
  (snapshot_id, observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, week_start, entry_count, league)
values
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000d5',
   'user.get.arena.info', 'test', 'test:ret:a1', now() - interval '40 days',
   '00000000-0000-4000-8000-00000000cf01', 580, 580,
   public.reset_week_start(now() - interval '40 days'), 1, 1);
insert into public.arena_entries
  (snapshot_id, arena_snapshot_id, observation_id, source_command, parser_version,
   idempotency_key, captured_at, collector_id, collected_from_server_id, server_id,
   game_uid, player_id, rank, score)
values
  ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000e9',
   '00000000-0000-4000-8000-0000000000d6', 'user.get.arena.info', 'test', 'test:ret:e1',
   now() - interval '40 days', '00000000-0000-4000-8000-00000000cf01', 580, 580,
   910000580, '00000000-0000-4000-8000-0000000000c1', 1, 1000);

-- Only an admin may even ask.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000e2');
select throws_ok($$ select * from public.retention_report() $$, '42501', null,
  'a member cannot run retention, not even the report');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000e1');

-- The report counts and changes nothing.
select isnt_empty($$ select * from public.retention_report() $$,
  'an admin gets a report');
select is(
  (select rows from public.retention_report() where relation = 'player_snapshots'),
  1::bigint, 'one power reading is out of window — the stranger''s, not ours');
select is(
  (select count(*) from public.player_snapshots), 2::bigint,
  'and the report deleted nothing');

-- Now the delete.
select lives_ok($$ select * from public.retention_report(true) $$, 'p_confirm deletes');

select is(
  (select count(*) from public.player_snapshots
   where player_id = '00000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'our departed member keeps a 40-day-old reading');
select is(
  (select count(*) from public.player_snapshots
   where player_id = '00000000-0000-4000-8000-0000000000c2'),
  0::bigint, 'the stranger''s is gone');

-- Departures are derived from these rows, so ours has to outlive the week.
select is(
  (select count(*) from public.alliance_member_snapshots
   where alliance_id = '00000000-0000-4000-8000-0000000000aa'),
  1::bigint, 'our alliance''s roster history survives');
select is(
  (select count(*) from public.alliance_member_snapshots
   where alliance_id = '00000000-0000-4000-8000-0000000000bb'),
  0::bigint, 'a stranger alliance''s does not');

-- The two that would be worst to get wrong.
select is(
  (select assigned_rank from public.player_ranks
   where player_id = '00000000-0000-4000-8000-0000000000c1'),
  'R4', 'an assigned rank is untouched — no capture could reconstruct it');
-- Scoped to this board. The seed ships arena entries of its own, and counting
-- them all made the first version of this assertion read 21.
select is(
  (select count(*) from public.arena_entries
   where arena_snapshot_id = '00000000-0000-4000-8000-0000000000e9'),
  1::bigint, 'and an arena board carrying one of ours was not cascaded away');
reset role;

select * from finish();
rollback;
