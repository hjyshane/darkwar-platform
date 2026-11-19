-- 0335: a finished period rebuilt after it closed still sees who was away.
--
-- The grid fortnight 2026-08-17 02:00Z -> 08-31 02:00Z, built today, long
-- after it closed - which is what pressing Rebuild on a finished period does.
-- Three members, all on the roster since July, swept three times:
--
--   07-01 00:00Z  everybody online (Unseen with no presence at all)
--   08-31 01:00Z  an hour before the close: Away offline since 08-26 02:00Z,
--                 i.e. 120 hours at the close; Present online; Unseen still
--                 with no presence
--   now()         everybody online - Away came back after the period
--
-- The last sweep is what made the bug: `player_presence` holds only the newest
-- sighting, so after it every member's presence is dated after the close and
-- the old `observed_at <= measured_to` join found nothing. Away read as not
-- away, and the 11-16 CBFW period lost its three offline R1s that way.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000c335', 'offline close test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad335', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'offline-close-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad335', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- This file's alliance is the only one marked ours, by evidence too (0196).
update public.alliances set is_own = false, roster_unredacted_seen = false
where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab335', 580, 'ext-offline-close', 'OfflineCloseTest', true);

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000c3351', 580, 9335000000000001, 'Away',
   '00000000-0000-4000-8000-0000000ab335'),
  ('00000000-0000-4000-8000-0000000c3352', 580, 9335000000000002, 'Present',
   '00000000-0000-4000-8000-0000000ab335'),
  ('00000000-0000-4000-8000-0000000c3353', 580, 9335000000000003, 'Unseen',
   '00000000-0000-4000-8000-0000000ab335');

-- One roster row. Every member of a batch is written with the batch's own
-- instant, so `alliance_roster_latest` sees the whole roster, not one member.
create function pg_temp.roster(uid bigint, pid uuid, at timestamptz, state text,
                               since timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted, online_state, offline_since)
  values (gen_random_uuid(), 'al.rank', 'test', 'off335:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000c335', 580,
    '00000000-0000-4000-8000-0000000ab335', 580, uid, pid, 2, false, state, since);
$$;

select pg_temp.roster(9335000000000001, '00000000-0000-4000-8000-0000000c3351',
  '2026-07-01T00:00:00Z', 'online', null);
select pg_temp.roster(9335000000000002, '00000000-0000-4000-8000-0000000c3352',
  '2026-07-01T00:00:00Z', 'online', null);
select pg_temp.roster(9335000000000003, '00000000-0000-4000-8000-0000000c3353',
  '2026-07-01T00:00:00Z', null, null);

select pg_temp.roster(9335000000000001, '00000000-0000-4000-8000-0000000c3351',
  '2026-08-31T01:00:00Z', 'offline', '2026-08-26T02:00:00Z');
select pg_temp.roster(9335000000000002, '00000000-0000-4000-8000-0000000c3352',
  '2026-08-31T01:00:00Z', 'online', null);
select pg_temp.roster(9335000000000003, '00000000-0000-4000-8000-0000000c3353',
  '2026-08-31T01:00:00Z', null, null);

select pg_temp.roster(9335000000000001, '00000000-0000-4000-8000-0000000c3351',
  now(), 'online', null);
select pg_temp.roster(9335000000000002, '00000000-0000-4000-8000-0000000c3352',
  now(), 'online', null);
select pg_temp.roster(9335000000000003, '00000000-0000-4000-8000-0000000c3353',
  now(), 'online', null);

-- The cut stated rather than inherited from whatever the seed says: 120 hours
-- away is over it, an hour is not.
insert into public.app_settings (key, value)
values ('rank_tiers', jsonb_build_object(
  'r3_percent', 20, 'r2_percent', 50, 'offline_hours', 48,
  'weights', jsonb_build_object('donation', 1, 'duel', 1, 'power_growth', 1)))
on conflict (key) do update set value = excluded.value;

-- THE PRECONDITION, so the test is about the state production was in: the
-- current-presence row says Away is online, observed after the close. With
-- this row and nothing else, the scorer had no way to know about 08-31.
select is(
  (select online_state from public.player_presence
    where player_id = '00000000-0000-4000-8000-0000000c3351'),
  'online',
  'the current presence says Away is back, as it would days after the close');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad335');
select lives_ok(
  $$ select public.build_rank_period('2026-08-17T02:00:00Z') $$,
  'the finished fortnight builds');
reset role;

-- Through `rank_period_latest`, never with a version pinned (CLAUDE.md).
create function pg_temp.row_of(who text) returns public.rank_period_latest
language sql as $$
  select * from public.rank_period_latest
  where period_start = '2026-08-17T02:00:00Z' and name = who;
$$;

-- Rows first: every assertion below that expects a null would pass on a
-- missing row.
select is(
  (select count(*) from public.rank_period_latest
    where period_start = '2026-08-17T02:00:00Z'
      and name in ('Away', 'Present', 'Unseen')),
  3::bigint,
  'all three members have a row for the period');

select is(round((pg_temp.row_of('Away')).offline_hours), 120::numeric,
  'Away is measured as away 120 hours at the close, from the sighting before it');
select is((pg_temp.row_of('Away')).tier_reason, 'offline',
  'and is graded for the absence, rebuilt days after the period ended');
select is((pg_temp.row_of('Away')).tier, 'R1',
  'which is R1');

select is((pg_temp.row_of('Present')).offline_hours, 0::numeric,
  'Present, online at the close, is measured at zero - known, not unknown');
select isnt((pg_temp.row_of('Present')).tier_reason, 'offline',
  'and is not graded as away');

-- No presence at or before the close is "not known", never "away" - and the
-- sighting after the close, which does carry one, is not borrowed for it.
select is((pg_temp.row_of('Unseen')).offline_hours, null,
  'a member with no presence before the close reads null, not a figure from after it');

select * from finish();
rollback;
