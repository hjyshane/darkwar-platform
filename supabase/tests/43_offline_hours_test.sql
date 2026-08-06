-- 0075: an absence is measured to now, never to the end of a period still running.
--
-- The bug this pins produced a plausible number for everybody. A member last seen
-- an hour ago and one gone a week both read as ~262 hours away, because the
-- eleven unelapsed days of the fortnight were being added to both. Nothing on
-- screen said so; the report simply demoted 70 of 95 members.
--
-- The test therefore asserts the DIFFERENCE between two members, not one figure
-- against a constant: a wrong bound moves both by the same amount and any single
-- assertion could be made to pass by adjusting the expectation.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc75', 'offline test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad075', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'offline-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad075', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000000ab075', 580, 'ext-offline', 'OfflineTest', true);

-- Two members, both here since long before the period.
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000cb501', 580, 9500000000000001, 'JustLeft',
   '00000000-0000-4000-8000-0000000ab075'),
  ('00000000-0000-4000-8000-0000000cb502', 580, 9500000000000002, 'LongGone',
   '00000000-0000-4000-8000-0000000ab075');

create function pg_temp.roster(uid bigint, pid uuid, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'offr:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc75', 580,
    '00000000-0000-4000-8000-0000000ab075', 580, uid, pid, 2, false);
$$;

-- Long before the period, so neither counts as a witnessed newcomer.
select pg_temp.roster(9500000000000001, '00000000-0000-4000-8000-0000000cb501',
  now() - interval '60 days');
select pg_temp.roster(9500000000000002, '00000000-0000-4000-8000-0000000cb502',
  now() - interval '60 days');

-- THE PERIOD IS THE ONE RUNNING NOW, which is the whole point: its end is in the
-- future, and that is the bound 0071 was measuring absences to.
create function pg_temp.presence(pid uuid, since timestamptz)
returns void language sql as $$
  insert into public.player_presence (player_id, online_state, offline_since, observed_at)
  values (pid, 'offline', since, now() - interval '1 minute')
  on conflict (player_id) do update
    set online_state = 'offline', offline_since = excluded.offline_since,
        observed_at = excluded.observed_at;
$$;

-- One away two hours, one away ten days. Under the old bound both came out over
-- 200 hours and were indistinguishable.
select pg_temp.presence('00000000-0000-4000-8000-0000000cb501', now() - interval '2 hours');
select pg_temp.presence('00000000-0000-4000-8000-0000000cb502', now() - interval '10 days');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad075');
select lives_ok(
  $$ select public.build_rank_period(public.rank_period_start(now())) $$,
  'the period in progress builds');

create function pg_temp.row_of(who text) returns public.rank_period_snapshots
language sql as $$
  select * from public.rank_period_snapshots
  where period_start = public.rank_period_start(now()) and name = who
    and scoring_version = 4;
$$;

-- Two hours away reads as two hours, give or take the second the test takes.
select cmp_ok((pg_temp.row_of('JustLeft')).offline_hours, '<', 3::numeric,
  'somebody away two hours is measured at about two hours');
select cmp_ok((pg_temp.row_of('JustLeft')).offline_hours, '>', 1::numeric,
  'and not at zero, because they are in fact away');

select cmp_ok((pg_temp.row_of('LongGone')).offline_hours, '>', 239::numeric,
  'somebody away ten days is measured at about ten days');
select cmp_ok((pg_temp.row_of('LongGone')).offline_hours, '<', 241::numeric,
  'and not at ten days plus the rest of the fortnight');

-- THE ASSERTION THAT CANNOT BE SATISFIED BY A WRONG BOUND. Under `period_end`
-- both figures gain the same unelapsed remainder, so their RATIO collapses
-- towards 1 — 262 against 264 rather than 2 against 240. A ratio test fails for
-- the old code no matter how many days into the period it runs.
select cmp_ok(
  (pg_temp.row_of('LongGone')).offline_hours / (pg_temp.row_of('JustLeft')).offline_hours,
  '>', 50::numeric,
  'and the two are still an order of magnitude apart, which is what was lost');

-- The consequence that made this worth a migration: the default cut is 48 hours,
-- so exactly one of these two should be demoted for absence.
select is(
  (select count(*) from public.rank_period_snapshots
    where period_start = public.rank_period_start(now()) and scoring_version = 4
      and name in ('JustLeft', 'LongGone') and tier_reason = 'offline'),
  1::bigint,
  'so one of the two is demoted for absence and the other is not');

reset role;

select * from finish();
rollback;
