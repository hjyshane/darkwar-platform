-- 0081: a server rank and a cross-server rank are not the same number.
--
-- The live symptom this pins: our own alliance appeared to swing between 1st and
-- 7th every three minutes with its power unchanged. Both readings arrive under the
-- command name `alliance.rank` and their payloads are identical but for the rank
-- itself, so the only thing that tells them apart is how many servers the reading
-- covered. If that inference breaks, the chart lies quietly and the compare
-- table's rank column lies while being sorted on.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc81', 'scope test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000be081', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'scope-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000be081', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Ours on 580, plus one neighbour on 580 and one on 581 to make the boards
-- distinguishable at all.
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values
  ('00000000-0000-4000-8000-0000000a1081', 580, 'ext-scope-ours', 'ScopeOurs', false),
  ('00000000-0000-4000-8000-0000000a2081', 580, 'ext-scope-near', 'ScopeNear', false),
  ('00000000-0000-4000-8000-0000000a3081', 581, 'ext-scope-far', 'ScopeFar', false);

create function pg_temp.reading(
  obs uuid, at timestamptz, alliance uuid, srv int, rnk int, pw bigint)
returns void language sql as $$
  insert into public.alliance_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, external_id,
    name, power, member_count, rank)
  values (obs, 'alliance.rank', 'test',
    'scope:' || obs || ':' || alliance, at,
    '00000000-0000-4000-8000-00000000cc81', 580, alliance, srv, 'ext-scope',
    'ScopeTest', pw, 2, rnk);
$$;

-- READING 1 — the server board. Only 580 alliances in it, and we are second.
select pg_temp.reading('00000000-0000-4000-8000-00000000b101', '2026-08-05T05:00:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 2, 1000);
select pg_temp.reading('00000000-0000-4000-8000-00000000b101', '2026-08-05T05:00:00Z',
  '00000000-0000-4000-8000-0000000a2081', 580, 1, 900);

-- READING 2 — the cross-server board, three minutes later. Same power, rank 7,
-- and a 581 alliance in the same reading. This pair is the whole bug.
select pg_temp.reading('00000000-0000-4000-8000-00000000b102', '2026-08-05T05:03:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 7, 1000);
select pg_temp.reading('00000000-0000-4000-8000-00000000b102', '2026-08-05T05:03:00Z',
  '00000000-0000-4000-8000-0000000a3081', 581, 1, 5000);

-- A week on, both boards again: we climbed one place on the server board (1 -> 1
-- is no movement, so make it 2 -> 1) and one on the cross-server board (7 -> 6).
select pg_temp.reading('00000000-0000-4000-8000-00000000b103', '2026-08-12T05:00:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 1, 1200);
select pg_temp.reading('00000000-0000-4000-8000-00000000b103', '2026-08-12T05:00:00Z',
  '00000000-0000-4000-8000-0000000a2081', 580, 2, 800);
select pg_temp.reading('00000000-0000-4000-8000-00000000b104', '2026-08-12T05:03:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 6, 1200);
select pg_temp.reading('00000000-0000-4000-8000-00000000b104', '2026-08-12T05:03:00Z',
  '00000000-0000-4000-8000-0000000a3081', 581, 1, 5200);

-- TWO READINGS AT ONE INSTANT. Both boards opened close enough together that
-- the captures share a captured_at, and only observation_id separates them.
-- 0153 derives board_scope and board_size per OBSERVATION through a lateral;
-- keyed on anything coarser — captured_at being the obvious wrong choice —
-- these four rows fold into one board of four spanning two servers, and every
-- server-board reading in the archive silently becomes cross-server.
select pg_temp.reading('00000000-0000-4000-8000-00000000b105', '2026-08-19T05:00:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 1, 1300);
select pg_temp.reading('00000000-0000-4000-8000-00000000b105', '2026-08-19T05:00:00Z',
  '00000000-0000-4000-8000-0000000a2081', 580, 2, 700);
select pg_temp.reading('00000000-0000-4000-8000-00000000b106', '2026-08-19T05:00:00Z',
  '00000000-0000-4000-8000-0000000a1081', 580, 5, 1300);
select pg_temp.reading('00000000-0000-4000-8000-00000000b106', '2026-08-19T05:00:00Z',
  '00000000-0000-4000-8000-0000000a3081', 581, 1, 5300);

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000be081');

-- ------------------------------------------------------------------ the scope
select is(
  (select board_scope from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at = '2026-08-05T05:00:00Z'),
  'server',
  'a reading covering one server is the server board');

select is(
  (select board_scope from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at = '2026-08-05T05:03:00Z'),
  'cross_server',
  'a reading covering two is the cross-server board');

-- The number the reader needs to make sense of a rank. 7th of 100 is not worse
-- than 1st of 39.
select is(
  (select board_size from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at = '2026-08-05T05:03:00Z'),
  2::bigint,
  'and carries how many alliances were on it');

-- The symptom itself: two ranks for one alliance at one power, minutes apart. A
-- chart that cannot separate these draws a sawtooth and calls it movement.
select is(
  (select count(distinct rank) from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at between '2026-08-05T04:00:00Z' and '2026-08-05T06:00:00Z'),
  2::bigint,
  'the same alliance really is reported at two ranks minutes apart');

select is(
  (select count(distinct board_scope) from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at between '2026-08-05T04:00:00Z' and '2026-08-05T06:00:00Z'),
  2::bigint,
  'and the two are now separable');

-- The instant both boards were read. One reading is 580-only, the other spans
-- 580 and 581, and they share a captured_at.
select is(
  (select count(distinct board_scope) from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at = '2026-08-19T05:00:00Z'),
  2::bigint,
  'two readings at one instant stay two boards');
select is(
  (select max(board_size) from public.alliance_power_history
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'
      and captured_at = '2026-08-19T05:00:00Z'),
  2::bigint,
  'and each is sized by its own reading, not by the instant');

-- ----------------------------------------------------------------- the growth
-- Server board: 2nd, then 1st. One place climbed, not six.
select is(
  (select rank_climb from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'),
  1,
  'rank_climb measures the server board only');

select is(
  (select cross_rank_climb from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'),
  1,
  'and the cross-server board gets its own figure');

-- Before 0081 this was `rank_first(1) - rank_last(6) = -5`: an alliance that had
-- climbed on both boards, reported as having fallen five places.
select is(
  (select rank_last from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000a1081'),
  1,
  'the latest server rank is not the latest cross-server rank');

-- An alliance seen on only one board has nothing to say about the other. Null
-- rather than zero: it has not been measured there.
select is(
  (select cross_rank_climb from public.alliance_growth
    where alliance_id = '00000000-0000-4000-8000-0000000a2081'),
  NULL::int,
  'an alliance never seen on the cross-server board has no figure for it');

reset role;
select * from finish();
rollback;
