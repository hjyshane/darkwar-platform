-- 0053/0054: building a period. The two assertions that matter are the two
-- bugs the first real run produced, both of which left numbers that looked
-- entirely reasonable:
--
--   the duel total was zero for every member, because the function asked for
--   a contribution_type that does not exist ('duel_weekly' — the boards are
--   stored as alliance_battle_*). Nothing errors on a type matching no rows.
--
--   a single capture counted twice, because both weeks read "the newest at
--   or before my 01:59" and resolved to the same row. The total came out at
--   exactly double one week.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- A member of our own alliance, with contributions in each of the period's
-- two weeks so the windows can be told apart.
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab001', 580, 'ext-rank', 'RankTest', true);
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000ab101', 580, 9100000000000001, 'Busy',
   '00000000-0000-4000-8000-0000000ab001'),
  ('00000000-0000-4000-8000-0000000ab102', 580, 9100000000000002, 'Quiet',
   '00000000-0000-4000-8000-0000000ab001');

create function pg_temp.contribute(uid bigint, kind text, amount bigint, at timestamptz)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score, raw)
  values (gen_random_uuid(), 'test', 'test', 'rank:' || uid || ':' || kind || ':' || at,
          at, '00000000-0000-4000-8000-000000000c01', 580, 580, uid, kind, amount, '{}'::jsonb);
$$;

-- Period 2026-07-27T02:00Z: week ends are 2026-08-03T01:59Z and 08-10T01:59Z.
select pg_temp.contribute(9100000000000001, 'weekly_donation', 1000, '2026-08-03T01:00:00Z');
select pg_temp.contribute(9100000000000001, 'weekly_donation', 3000, '2026-08-10T01:00:00Z');
select pg_temp.contribute(9100000000000001, 'alliance_battle_weekly', 50000, '2026-08-03T01:00:00Z');
select pg_temp.contribute(9100000000000001, 'alliance_battle_weekly', 70000, '2026-08-10T01:00:00Z');
-- The quiet one only ever appears in week one.
select pg_temp.contribute(9100000000000002, 'weekly_donation', 10, '2026-08-03T01:00:00Z');
select pg_temp.contribute(9100000000000002, 'alliance_battle_weekly', 20, '2026-08-03T01:00:00Z');

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ab201', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rank-member@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000ab201', 'member', 'rank member');

-- Membership is required, and the refusal is the function's own.
set local role authenticated;
select throws_ok(
  $$ select public.build_rank_period('2026-07-27T02:00:00Z') $$,
  '42501', null, 'a logged-out visitor cannot build a period');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ab201')::text, true);
set local role authenticated;
select ok(public.build_rank_period('2026-07-27T02:00:00Z') >= 2,
  'a member can build one, and it covers the alliance');
reset role;

create function pg_temp.row_of(who text) returns public.rank_period_snapshots
language sql as $$
  select * from public.rank_period_snapshots
  where period_start = '2026-07-27T02:00:00Z' and name = who;
$$;

-- Each week read from its own window, so the two are different numbers.
select is((pg_temp.row_of('Busy')).donation_week1, 1000::bigint, 'week one is week one');
select is((pg_temp.row_of('Busy')).donation_week2, 3000::bigint, 'week two is week two');
-- 4000, not 2000 and not 8000. Double counting produced exactly twice one
-- week, which reads like a plausible fortnight and is not one.
select is((pg_temp.row_of('Busy')).donation_total, 4000::bigint,
  'the total is the two weeks added, each counted once');

-- The duel figure comes from alliance_battle_weekly. Asking for a type that
-- does not exist returned zero for everybody and looked like a real ranking,
-- because the donation half broke the ties.
select is((pg_temp.row_of('Busy')).duel_total, 120000::bigint,
  'the duel total comes from the board it is actually stored under');

-- A member with nothing in week two reports a null there rather than
-- repeating week one.
select is((pg_temp.row_of('Quiet')).donation_week2, null,
  'a week with no capture is unknown, not a repeat of the week before');

-- Rebuilding is idempotent: same inputs, same answer, one row per member.
select lives_ok(
  $$ select set_config('request.jwt.claims',
       json_build_object('sub', '00000000-0000-4000-8000-0000000ab201')::text, true);
     select public.build_rank_period('2026-07-27T02:00:00Z') $$,
  'building the same period again is allowed');
select is((select count(*) from public.rank_period_snapshots
           where period_start = '2026-07-27T02:00:00Z'
             and player_id = '00000000-0000-4000-8000-0000000ab101'), 1::bigint,
  'and leaves one row, not two');

select * from finish();
rollback;
