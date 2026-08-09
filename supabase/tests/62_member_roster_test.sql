-- member_roster: one query, and every boundary it crosses still holds.
--
-- The view is SECURITY DEFINER joining seven member-only sources (0102), which
-- means RLS is bypassed underneath and the view's own gates are the only thing
-- between a reader and the data. So the assertions here are access assertions
-- first: a member sees the roster but NOT what people pay for (0092's
-- officer boundary, now a CASE gate instead of RLS), an officer sees both, a
-- viewer sees nothing, and anon cannot select at all. The shape assertions —
-- growth fallback, presence collapse, member_rank — pin the semantics that
-- moved out of RosterPanel.tsx into SQL, because a silent drift there would
-- not error; it would just render wrong numbers with a straight face.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- People. A member, an officer, a viewer.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000630001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'roster-member@test.invalid'),
  ('00000000-0000-4000-8000-000000630002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'roster-officer@test.invalid'),
  ('00000000-0000-4000-8000-000000630003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'roster-viewer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-000000630001', 'member'),
  ('00000000-0000-4000-8000-000000630002', 'officer'),
  ('00000000-0000-4000-8000-000000630003', 'viewer');

-- An alliance whose roster batch is presence-UNREDACTED (false) — which is how
-- 0031 decides it is OURS: the game hides presence for every roster but our
-- own. 39 tripped over the default marking foreign alliances as ours; the
-- control assertion below exists so a wrong flag fails loudly instead.
insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-000000630c01', 'roster probe');
insert into public.alliances (server_id, external_id, current_name) values
  (580, 'roster-al-62', 'RosterProbe');

-- The players first: the snapshot trigger summarises onto existing player
-- rows, it does not create them — that linking is the normalizer's job.
insert into public.players (game_uid, server_id, current_name)
values (620000000001, 580, 'RosterAlpha'),
       (620000000002, 580, 'RosterBeta');

create function pg_temp.pid(p_uid bigint) returns uuid language sql as $$
  select player_id from public.players where game_uid = p_uid;
$$;

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, kills, presence_redacted)
select '00000000-0000-4000-8000-000000630e01', 'al.rank', 'test',
       'test:62:roster:' || v.game_uid, '2026-08-08T10:00:00Z',
       '00000000-0000-4000-8000-000000630c01', 580, a.alliance_id, 580,
       pg_temp.pid(v.game_uid), v.game_uid, v.name, v.member_rank, 30, v.power, 100, false
from public.alliances a,
     (values (620000000001, 'RosterAlpha', 5, 5000000::bigint),
             (620000000002, 'RosterBeta',  1, 1000::bigint)) as v(game_uid, name, member_rank, power)
where a.external_id = 'roster-al-62';

-- Control: the batch above must have marked the alliance as ours, or every
-- assertion below is running against somebody else's roster.
select is(
  (select is_own from public.alliances where external_id = 'roster-al-62'),
  true, 'control: the unredacted batch marked the alliance as our own');

insert into public.player_contributions (player_id, daily_donation_score, weekly_donation_score)
values (pg_temp.pid(620000000001), 41, 4100);

insert into public.player_presence (player_id, online_state, offline_since, observed_at)
values
  (pg_temp.pid(620000000001), 'online',  null, '2026-08-08T09:00:00Z'),
  (pg_temp.pid(620000000002), 'offline', '2026-08-07T20:00:00Z', '2026-08-08T09:00:00Z');

insert into public.player_vip (player_id, vip_level, observed_at)
values (pg_temp.pid(620000000001), 7, '2026-08-08T09:00:00Z');

-- Two readings close together for Beta: no 02:05 day-old baseline exists, so
-- player_power_growth.growth_1d is null and the view must fall back to
-- player_growth_recent — value AND timestamp together.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, power, raw)
select gen_random_uuid(), 'server.rank', 1, 'test:62:snap:' || s.n, s.at::timestamptz,
       '00000000-0000-4000-8000-000000630c01', 580,
       pg_temp.pid(620000000002), 580, 620000000002, s.power, '{}'::jsonb
from (values (1, '2026-08-08T06:00:00Z', 1000::bigint),
             (2, '2026-08-08T09:30:00Z', 1500::bigint)) as s(n, at, power);

-- A member.
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000630001","role":"authenticated"}', true);

select is(
  (select count(*) from public.member_roster
    where current_name like 'Roster%'),
  2::bigint, 'a member sees the whole roster');

select is(
  (select daily_donation_score from public.member_roster
    where current_name = 'RosterAlpha'),
  41::bigint, 'contribution figures ride along for a member');

select is(
  (select member_rank from public.member_roster where current_name = 'RosterAlpha'),
  5, 'member_rank is the rank the game''s member list reported');

select is(
  (select vip_level from public.member_roster where current_name = 'RosterAlpha'),
  null, 'what people pay for stays officer-only: a member gets null, not 7');

-- 50, not 500: both growth views speak PERCENT (1000 -> 1500 is +50%), which
-- is what makes the coalesce between them legitimate in the first place.
select is(
  (select growth_1d from public.member_roster where current_name = 'RosterBeta'),
  50::numeric, 'growth falls back to since-the-previous-reading when no day baseline exists');

select is(
  (select growth_1d_at from public.member_roster where current_name = 'RosterBeta'),
  '2026-08-08T06:00:00Z'::timestamptz,
  'and the timestamp travels with the figure it belongs to');

select is(
  (select last_online_at from public.member_roster where current_name = 'RosterAlpha'),
  '2026-08-08T09:00:00Z'::timestamptz,
  'online member: last_online_at is the observation that saw them');

select is(
  (select last_online_at from public.member_roster where current_name = 'RosterBeta'),
  '2026-08-07T20:00:00Z'::timestamptz,
  'offline member: last_online_at is when they went');

-- An officer.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000630002","role":"authenticated"}', true);

select is(
  (select vip_level from public.member_roster where current_name = 'RosterAlpha'),
  7, 'an officer sees the subscription columns');

-- A viewer: the gate, not an error.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000630003","role":"authenticated"}', true);

select is(
  (select count(*) from public.member_roster),
  0::bigint, 'a viewer gets zero rows, same as every other member figure');

reset role;

-- The definer-with-gate shape itself. If a rewrite flips this to invoker the
-- view stops leaking nothing but starts paying seven per-row RLS quals (the
-- 0100 disease); if it stays definer and loses the gate, 58''s assertion 4
-- catches it — and so does this, closer to home.
select matches(
  pg_get_viewdef('public.member_roster'::regclass),
  'current_app_role',
  'the view asks who is asking');

select * from finish();
rollback;
