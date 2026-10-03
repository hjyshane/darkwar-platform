-- 0213: Sunday is not a duel day; each event names its tab.
--
-- Week of Monday 2026-09-21. Alpha scores on the duel board Saturday 09-26;
-- Sunday 09-27's board is read at 0 for everybody. The donation board is read
-- on both days, and Sunday still counts there.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000c901', 580, 'ext-sun', 'SundayTest', true, 1);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000c901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level)
values ('00000000-0000-4000-8000-00000000c101', 580, 9250000000000101, 'Alpha', 90, 30);

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
values ('00000000-0000-4000-8000-00000000c0b1', 'al.rank', 'test', 'test:119:roster',
        now() - interval '1 day', '00000000-0000-4000-8000-000000000c01', 580,
        '00000000-0000-4000-8000-00000000c901', 580, '00000000-0000-4000-8000-00000000c101',
        9250000000000101, 'Alpha', 3, 30, 1, false, 'online');

create function pg_temp.reading(key text, kind text, at timestamptz, score bigint)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, contribution_type, score)
  values ('00000000-0000-4000-8000-00000000c0b2', 'test.board', 'test', 'test:119:' || key,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, 9250000000000101, kind, score);
$$;

select pg_temp.reading('d-sat', 'alliance_battle_daily', '2026-09-26T20:00:00Z', 120);
select pg_temp.reading('d-sun', 'alliance_battle_daily', '2026-09-27T20:00:00Z', 0);
select pg_temp.reading('g-sat', 'daily_donation', '2026-09-26T20:00:00Z', 5);
select pg_temp.reading('g-sun', 'daily_donation', '2026-09-27T20:00:00Z', 5);

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000c301', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sun-member@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-00000000c301', 'member', 'sun member');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000c301')::text, true);
set local role authenticated;

create temp table r on commit drop as
  select * from public.member_participation('2026-09-21T02:00:00Z', '2026-09-28T02:00:00Z');

-- 1-3. The duel board read on Sunday is not a duel day.
select is((select duel_days_read from r), 1, 'Sunday''s duel board is not counted as read');
select is((select duel_days_scored from r), 1, 'so a full week of play is 1 of 1, not 1 of 2');
-- Donations run every day.
select is((select donation_days_read from r), 2, 'the donation board keeps Sunday');

-- 4-5. Each event names its tab.
select is(
  (select array_agg(kind order by kind) from public.attendance_event_kinds where board = 'season'),
  array['furnace_fury', 'ice_pit'], 'Ice Pit and Furnace Fury are season events');
select is(
  (select array_agg(kind order by kind) from public.attendance_event_kinds where board = 'event'),
  array['capital_clash', 'frankie', 'server_clash'], 'the rest are events');

select * from finish();
rollback;
