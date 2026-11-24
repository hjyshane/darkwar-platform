-- 0352: a member's comments are limited, and nobody signed in calls the
-- refreshes. Negative cases first (§20.2), each beside a positive: a limit
-- that refused everybody would pass a "refused" test by accident.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0352', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'limits-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000c0352', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'limits-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0352', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'limits-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000e0352', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'limits-busy@test.invalid');

insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000a0352', 'admin', 'LimitAdmin'),
  ('00000000-0000-4000-8000-0000000c0352', 'member', 'LimitMember'),
  ('00000000-0000-4000-8000-0000000d0352', 'member', 'LimitOther'),
  ('00000000-0000-4000-8000-0000000e0352', 'member', 'LimitBusy');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000000a0352');
insert into public.guides (guide_id, title, body, category, published_at) values
  ('00000000-0000-4000-8000-000000020352', 'Limits', 'Read me.', 'tip', now());

create function pg_temp.comment(n int) returns void language sql as $$
  insert into public.post_comments (guide_id, body)
  values ('00000000-0000-4000-8000-000000020352', 'comment ' || n);
$$;

-- 1-2. Five in a minute go through; the sixth is refused with DW429.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0352');
select lives_ok(
  $$ select pg_temp.comment(n) from generate_series(1, 5) n $$,
  'a member may post five comments in a minute');
select throws_ok(
  $$ select pg_temp.comment(6) $$,
  'DW429', null,
  'the sixth comment in a minute is refused');

-- 3. The limit is per account: somebody else may still comment.
select pg_temp.act_as('00000000-0000-4000-8000-0000000d0352');
select lives_ok($$ select pg_temp.comment(1) $$,
  'another member is not held back by the first one''s comments');

-- 4-6. The hour, for a member who has written 58 in the last hour but none in
-- the last minute. Written as the owner with that member's claims, because the
-- actor trigger (0113) takes the author from auth.uid() and keeps created_at.
reset role;
select pg_temp.act_as('00000000-0000-4000-8000-0000000e0352');
insert into public.post_comments (guide_id, body, created_at)
select '00000000-0000-4000-8000-000000020352', 'old ' || n, now() - interval '20 minutes'
  from generate_series(1, 58) n;
select is(
  (select count(*)::int from public.post_comments
    where author_user_id = '00000000-0000-4000-8000-0000000e0352'
      and created_at > now() - interval '1 hour'),
  58, 'the busy member has 58 comments in the last hour, none in the last minute');
set local role authenticated;
select lives_ok($$ select pg_temp.comment(59) $$, 'the 59th in an hour goes through');
select throws_ok($$ select pg_temp.comment(60) $$, 'DW429', null,
  'the 60th in an hour is refused');

-- 7. Nobody signed in (the collector, a definer job) is not limited.
reset role;
select set_config('request.jwt.claims', '{}', true);
select lives_ok(
  $$ insert into public.post_comments (guide_id, body, author_user_id)
     values ('00000000-0000-4000-8000-000000020352', 'from a job',
             '00000000-0000-4000-8000-0000000c0352') $$,
  'a write with no signed-in caller is not counted against anybody');

-- 8-12. The refreshes: authenticated may not execute any of the five, and the
-- service role still may (the snapshot triggers' writers).
select is(
  array(
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('refresh_alliance_growth', 'refresh_alliance_latest',
                         'refresh_member_roster', 'refresh_member_roster_players',
                         'refresh_player_season_buildings')
       and has_function_privilege('authenticated', p.oid, 'execute')
     order by 1),
  array[]::text[],
  'no refresh function is executable by authenticated');
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('refresh_alliance_growth', 'refresh_alliance_latest',
                        'refresh_member_roster', 'refresh_member_roster_players',
                        'refresh_player_season_buildings')
      and has_function_privilege('service_role', p.oid, 'execute')),
  5, 'the service role may still run all five');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0352');
select throws_ok('select public.refresh_member_roster()', '42501', null,
  'a member calling the roster refresh directly is refused');
select throws_ok('select public.refresh_alliance_growth(null)', '42501', null,
  'and the growth refresh');
reset role;
select ok(
  not has_function_privilege('authenticated', 'public.post_comments_throttle()', 'execute'),
  'the throttle itself is not callable');

select * from finish();
rollback;
