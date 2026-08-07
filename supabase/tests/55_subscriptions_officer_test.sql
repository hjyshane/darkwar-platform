-- 0092: who may read what somebody is paying for.
--
-- §20.2 wants the negative case proved rather than assumed, and this is a
-- widening of 0016's audience — the migration that closed the monthly pass
-- because it was leaking to every reader. So the assertions that matter most are
-- the ones about a MEMBER seeing nothing.
--
-- The RLS here filters rather than raises: a member's query returns zero rows,
-- not 42501. That is deliberate (0016) — the dashboard shows a dash instead of an
-- error — and it is also the shape most likely to be broken silently by a later
-- policy, since a widened policy is OR'd with the ones already there.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ------------------------------------------------------------------ the shape
select has_table('public', 'player_vip', 'VIP has its own row-secured table');
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.player_vip'::regclass),
  'with row level security on');

-- The audience, read off the policy rather than off a comment.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'player_vip'),
  1,
  'one policy on player_vip — two would be OR''d and widen it silently');

select ok(
  (select qual like '%officer%' and qual like '%admin%'
   from pg_policies where schemaname = 'public' and tablename = 'player_vip'),
  'and it names officer and admin');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'player_month_cards'),
  1,
  'the monthly pass still has exactly one policy after being widened');

select ok(
  (select qual not like '%member%'
   from pg_policies where schemaname = 'public' and tablename = 'player_month_cards'),
  'and it does not name member — this widened to officer, it did not open up');

-- --------------------------------------------------------------- the writing
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000c1092', 580, 9900000000000921, 'Payer');

-- Two readings, the older one arriving second, so the newer-wins gate is tested
-- rather than the insert order.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, raw)
values
  ('00000000-0000-4000-8000-00000000e092', 'get.user.info.multi', 'test',
   'vip-new-0092', '2026-08-06T00:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000c1092', 580, 9900000000000921,
   '{"vipLevel": 9, "vipEndTime": 1790000000, "svipLevel": 2}'::jsonb),
  ('00000000-0000-4000-8000-00000000e092', 'get.user.info.multi', 'test',
   'vip-old-0092', '2026-08-01T00:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000c1092', 580, 9900000000000921,
   '{"vipLevel": 7, "vipEndTime": 1780000000, "svipLevel": 1}'::jsonb);

select is(
  (select vip_level from public.player_vip
   where player_id = '00000000-0000-4000-8000-0000000c1092'),
  9,
  'the newest reading wins, whatever order the rows arrived in');

-- A response with no VIP fields must not blank a known standing. This is the
-- failure mode the `raw ? 'vipLevel'` guard exists for: a profile response that
-- carried something else would otherwise write nulls over a real reading.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, raw)
values
  ('00000000-0000-4000-8000-00000000e092', 'get.user.info.multi', 'test',
   'vip-silent-0092', '2026-08-07T00:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000c1092', 580, 9900000000000921,
   '{"name": "Payer"}'::jsonb);

select is(
  (select vip_level from public.player_vip
   where player_id = '00000000-0000-4000-8000-0000000c1092'),
  9,
  'a later reading that says nothing about VIP does not erase what we knew');

-- 0 means "never had one" and is an absence; an expired date is a fact worth
-- keeping, because it says they used to pay.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000c2092', 580, 9900000000000922, 'NeverPaid');
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, raw)
values
  ('00000000-0000-4000-8000-00000000e092', 'get.user.info.multi', 'test',
   'vip-zero-0092', '2026-08-06T00:00:00Z',
   '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000c2092', 580, 9900000000000922,
   '{"vipLevel": 0, "vipEndTime": 0}'::jsonb);

select is(
  (select vip_expires_at from public.player_vip
   where player_id = '00000000-0000-4000-8000-0000000c2092'),
  NULL::timestamptz,
  'an epoch of 0 is no subscription, not 1970');

select is(
  (select vip_level from public.player_vip
   where player_id = '00000000-0000-4000-8000-0000000c2092'),
  0,
  'but VIP 0 is a level they really are, and stays 0 rather than becoming null');

-- ------------------------------------------------------------- who may read
-- A pgTAP session has no app_role, so `current_app_role()` returns 'viewer' —
-- which stands in for every reader below officer, members included.
set local role authenticated;

select is(
  (select count(*) from public.player_vip),
  0::bigint,
  'a reader below officer sees no VIP row at all');

select is(
  (select count(*) from public.player_subscriptions),
  0::bigint,
  'and none through the view either — the gate is in SQL, not in the client');

reset role;

select * from finish();
rollback;
