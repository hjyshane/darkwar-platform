-- 0155: a weekly reading under the alliance floor costs one tier step.
--
-- The tier cut is a percentile, so a test that leaves the cuts at their real
-- values asserts against whatever the fixture's distribution happens to
-- produce. Both cases below pin the cuts instead — first everybody R3, then
-- everybody R1 — so the only thing that can move a tier is the floor, which
-- is the thing under test.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc89', 'minimum test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad089', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'minimum-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad089', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab089', 580, 'ext-minimum', 'MinimumTest', true);

-- Three members: one clear of both floors, one under the donation floor, and
-- one nobody has captured at all.
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000cb891', 580, 9890000000000001, 'Clears',
   '00000000-0000-4000-8000-0000000ab089'),
  ('00000000-0000-4000-8000-0000000cb892', 580, 9890000000000002, 'Under',
   '00000000-0000-4000-8000-0000000ab089'),
  ('00000000-0000-4000-8000-0000000cb893', 580, 9890000000000003, 'Unseen',
   '00000000-0000-4000-8000-0000000ab089');

create function pg_temp.roster(uid bigint, pid uuid) returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'minr:' || uid,
    now() - interval '60 days', '00000000-0000-4000-8000-00000000cc89', 580,
    '00000000-0000-4000-8000-0000000ab089', 580, uid, pid, 2, false);
$$;

-- Long before the period, so none of them is a witnessed newcomer (0072).
select pg_temp.roster(9890000000000001, '00000000-0000-4000-8000-0000000cb891');
select pg_temp.roster(9890000000000002, '00000000-0000-4000-8000-0000000cb892');
select pg_temp.roster(9890000000000003, '00000000-0000-4000-8000-0000000cb893');

-- Week one of the fortnight now running. The scorer takes the newest reading
-- inside the window, so one reading per member per board is enough.
create function pg_temp.donate(uid bigint, kind text, score bigint)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, game_uid,
    contribution_type, score)
  values (gen_random_uuid(), 'al.rank.info', 'test',
    'minc:' || uid || ':' || kind,
    public.rank_period_start(now()) + interval '1 day',
    '00000000-0000-4000-8000-00000000cc89', 580, 580, uid, kind, score);
$$;

select pg_temp.donate(9890000000000001, 'weekly_donation', 5000);
select pg_temp.donate(9890000000000001, 'alliance_battle_weekly', 5000);
select pg_temp.donate(9890000000000002, 'weekly_donation', 100);
select pg_temp.donate(9890000000000002, 'alliance_battle_weekly', 5000);
-- 'Unseen' gets nothing, deliberately.

create function pg_temp.tiers(r3 numeric, mins boolean) returns void language sql as $$
  insert into public.app_settings (key, value)
  values ('rank_tiers', jsonb_build_object(
    'r3_percent', r3,
    'r2_percent', 100 - r3,
    'offline_hours', 100000,
    'weights', jsonb_build_object('donation', 0.5, 'duel', 0.5, 'power_growth', 0),
    'minimums', jsonb_build_object(
      'enabled', mins, 'donation_weekly', 500, 'duel_weekly', 0)))
  on conflict (key) do update set value = excluded.value;
$$;

create function pg_temp.tier_of(pid uuid) returns text language sql as $$
  select tier from public.rank_period_latest
  where player_id = pid and period_start = public.rank_period_start(now());
$$;
create function pg_temp.flag_of(pid uuid) returns boolean language sql as $$
  select below_minimum from public.rank_period_latest
  where player_id = pid and period_start = public.rank_period_start(now());
$$;

-- ------------------------------------------------- everybody R3, floors off
select pg_temp.tiers(100, false);

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad089');
select lives_ok(
  $$ select public.build_rank_period(public.rank_period_start(now())) $$,
  'the period builds with the floors switched off');

select is(pg_temp.tier_of('00000000-0000-4000-8000-0000000cb892'), 'R3',
  'with the cut at 100% and no floor, the member under it is still R3');
select is(pg_temp.flag_of('00000000-0000-4000-8000-0000000cb892'), false,
  'and carries no flag, because the floor is not being applied');
reset role;

-- -------------------------------------------------- same fixture, floors on
select pg_temp.tiers(100, true);

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad089');
select lives_ok(
  $$ select public.build_rank_period(public.rank_period_start(now())) $$,
  'and rebuilds with them on');

select is(pg_temp.tier_of('00000000-0000-4000-8000-0000000cb892'), 'R2',
  'the member under the donation floor drops exactly one step');
select is(pg_temp.tier_of('00000000-0000-4000-8000-0000000cb891'), 'R3',
  'the one who cleared both floors does not move');
select is(
  (select minimum_missed from public.rank_period_latest
    where player_id = '00000000-0000-4000-8000-0000000cb892'
      and period_start = public.rank_period_start(now())),
  'donation',
  'and the row says which floor it was');

-- A MEMBER WITH NO READING IS NOT UNDER THE FLOOR. This is the assertion that
-- keeps a daily-style rule out of a weekly one: absence is not zero, and a
-- member the collector never captured must not be demoted for our own gap.
select is(pg_temp.flag_of('00000000-0000-4000-8000-0000000cb893'), false,
  'a member with no reading at all is not below the minimum');
reset role;

-- ------------------------------------------------------- the bottom of the ladder
-- Cuts at zero put everybody in R1, which has nothing beneath it in the game.
select pg_temp.tiers(0, true);

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad089');
select lives_ok(
  $$ select public.build_rank_period(public.rank_period_start(now())) $$,
  'rebuilds with every cut at the bottom');
select is(pg_temp.tier_of('00000000-0000-4000-8000-0000000cb892'), 'R1',
  'an R1 under the floor stays R1 — the game has no rank below it');
reset role;

select * from finish();
rollback;
