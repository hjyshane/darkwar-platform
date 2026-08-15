-- 0114 + 0118: the activity score counts what happened, once per day, and the
-- screen totals whatever range it is asked for.
--
-- The §20.2 negative is under "WHO MAY READ IT": a member reads their own
-- activity and nobody else's. It matters more than it looks — a participation
-- score is a league table of who is paying attention, and publishing it to the
-- whole alliance turns a nudge into a public ranking of effort that nobody
-- consented to. `members.manage` sees everybody, and that is the screen it was
-- asked for. BOTH views are asserted there, because they gate on different
-- sources: `activity_daily` on the events, `activity_members` on `app_users`.
--
-- The rest pins the rules that make the number mean anything: the daily cap
-- (or the score is farmable by reloading), the 02:00 day boundary (or the hour
-- before a Monday reset is worth a free login), and one row per day (or no
-- range but the hard-coded one is answerable at all).
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0114', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'score-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0114', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'score-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000c0114', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'score-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0114', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'score-viewer@test.invalid');

insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-000000010114', 580, 9900000000000114, 'Tally');

insert into public.app_users (user_id, role, player_id, display_name) values
  ('00000000-0000-4000-8000-0000000a0114', 'admin', null, 'TheAdmin'),
  ('00000000-0000-4000-8000-0000000b0114', 'member',
   '00000000-0000-4000-8000-000000010114', 'not-the-character'),
  ('00000000-0000-4000-8000-0000000c0114', 'member', null, 'TheOther'),
  ('00000000-0000-4000-8000-0000000d0114', 'viewer', null, 'TheViewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- THE DAY BOUNDARY
-- ---------------------------------------------------------------------------

-- 02:00, not midnight. A sign-in at 01:00 on Monday belongs to Sunday's
-- activity day and to LAST week — the two boundaries have to agree or that
-- hour is worth a free extra login.
select is(
  public.activity_day_of('2026-08-10T01:00:00Z'),
  '2026-08-09'::date,
  'the hour before the reset still belongs to the previous day');

select is(
  public.activity_day_of('2026-08-10T02:00:00Z'),
  '2026-08-10'::date,
  'and the reset itself starts the new one');

-- Days nest inside weeks: the moment that starts an activity day at a week
-- boundary is the same moment that starts the week.
select is(
  public.activity_day_of(public.reset_week_start('2026-08-12T09:00:00Z')),
  '2026-08-10'::date,
  'a week starts on the first moment of an activity day, not mid-day');

-- ---------------------------------------------------------------------------
-- ONCE A DAY
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0114');

select lives_ok(
  $$ insert into public.activity_events (user_id, kind)
     values ('00000000-0000-4000-8000-0000000b0114', 'login') $$,
  'a member records their sign-in');

-- THE ANTI-FARMING RULE. The client inserts on every visit and the key refuses
-- the repeats, which is the bargain post_reads makes too (0079).
select throws_ok(
  $$ insert into public.activity_events (user_id, kind)
     values ('00000000-0000-4000-8000-0000000b0114', 'login') $$,
  '23505',
  NULL,
  'but signing in again the same day scores nothing');

select lives_ok(
  $$ insert into public.activity_events (user_id, kind)
     values ('00000000-0000-4000-8000-0000000b0114', 'rank_alliance') $$,
  'opening a different board is a different row');

-- Nobody writes anybody else's day.
select throws_ok(
  $$ insert into public.activity_events (user_id, kind)
     values ('00000000-0000-4000-8000-0000000c0114', 'login') $$,
  '42501',
  NULL,
  'and a member cannot record activity for somebody else');

-- An event is something that happened. Re-earning the day by deleting it is
-- the hole this closes.
select throws_ok(
  $$ delete from public.activity_events
      where user_id = '00000000-0000-4000-8000-0000000b0114' and kind = 'login' $$,
  '42501',
  NULL,
  'nor delete one to earn the day again');

-- A viewer has not been admitted and scores nothing.
select pg_temp.act_as('00000000-0000-4000-8000-0000000d0114');
select throws_ok(
  $$ insert into public.activity_events (user_id, kind)
     values ('00000000-0000-4000-8000-0000000d0114', 'login') $$,
  '42501',
  NULL,
  'a viewer records nothing at all');

-- ---------------------------------------------------------------------------
-- THE ARITHMETIC
-- ---------------------------------------------------------------------------

-- A comment, which is the one uncapped component. Written on a published guide
-- so the member can actually see it.
reset role;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0114');
insert into public.guides (guide_id, title, body, category, published_at)
values ('00000000-0000-4000-8000-000000020114', 'Scoring', 'x', 'tip', now());

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0114');
insert into public.post_comments (guide_id, body)
values ('00000000-0000-4000-8000-000000020114', 'Noted.');

-- 1 login + 1 board (0.5) + 1 comment (2) = 3.5, all on one day, so one row.
select is(
  (select points from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  3.5::numeric,
  'a login, one board and one comment come to three and a half');

select is(
  (select comment_count from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  1::bigint,
  'and the comment is counted on the day it was written');

-- THE DELETION RULE this alliance chose: removing a comment takes its points.
-- This is the whole reason the count is derived from post_comments rather than
-- logged as an event — a logged one would have kept them.
update public.post_comments set deleted_at = now()
 where author_user_id = '00000000-0000-4000-8000-0000000b0114';

select is(
  (select points from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  1.5::numeric,
  'deleting the comment takes its two points back');

-- ---------------------------------------------------------------------------
-- ONE ROW PER DAY, SO ANY RANGE IS A FILTER (0118)
-- ---------------------------------------------------------------------------

-- Activity from before this week. Inserted as the table owner because the
-- point is to place a row on an earlier day, which a member's own client can
-- never do — the generated column takes the day from `occurred_at`.
reset role;
insert into public.activity_events (user_id, kind, occurred_at)
values ('00000000-0000-4000-8000-0000000b0114', 'rank_server',
        public.reset_week_start(now()) - interval '1 hour');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0114');

-- It does not fold into today. That is what makes a range possible at all:
-- 0114 aggregated the week away, and this member would have had one row.
select is(
  (select count(*) from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  2::bigint,
  'an earlier day is its own row rather than folded into today');

-- ALL TIME is the default the screen uses, and it is simply no filter.
select is(
  (select sum(points) from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  2.0::numeric,
  'summed over all time that is two points');

-- THE GAME WEEK IS STILL ONE `where` CLAUSE — 0114's original question did not
-- become unanswerable, it stopped being the only answer.
select is(
  (select coalesce(sum(points), 0) from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'
      and day >= public.activity_day_of(public.reset_week_start(now()))),
  1.5::numeric,
  'and this game week alone is still one and a half');

-- ---------------------------------------------------------------------------
-- WHO MAY READ IT — the §20.2 negative, and its positive
-- ---------------------------------------------------------------------------

-- THE OTHER MEMBER HAS TO HAVE A SCORE TOO, or the negative below is
-- worthless. Written as the table owner so it exists regardless of policy.
--
-- This is not padding. The first version of this file asserted "the member
-- sees one row with points" while nobody else had any, so it passed whether or
-- not the view leaked — and the view DID leak, because `security_invoker` had
-- been described in a comment and never written. 0055's lesson, earned again:
-- an assertion that cannot fail is not evidence.
reset role;
insert into public.activity_events (user_id, kind)
values ('00000000-0000-4000-8000-0000000c0114', 'login'),
       ('00000000-0000-4000-8000-0000000c0114', 'rank_player');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0114');

-- THE NEGATIVE. A score is a table of who is paying attention; publishing it
-- to the whole alliance is not what was asked for.
select is(
  (select count(distinct user_id) from public.activity_daily),
  1::bigint,
  'a member sees activity for themselves and nobody else');

-- The name list is gated too, and separately — it reads `app_users` rather
-- than `activity_events`, so a leak there would expose the roster even with
-- the daily rows locked down.
select is(
  (select count(*) from public.activity_members),
  1::bigint,
  'and cannot even see that the other members exist here');

-- And the positive beside it, so neither view is passing by refusing everybody
-- (0055): the admin sees the same member's real numbers.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0114');
select is(
  (select sum(points) from public.activity_daily
    where user_id = '00000000-0000-4000-8000-0000000b0114'),
  2.0::numeric,
  'somebody who manages members sees everybody''s');

-- Every member appears, including the ones who have done nothing — the screen
-- is for finding those, and a missing row reads as a loading fault. The viewer
-- does not: they can do none of the four things, so a row of zeroes against
-- their name is noise.
--
-- Asserted on THIS FIXTURE'S users rather than as a total count. A bare
-- `count(*) = 4` also passes when the database happens to hold four rows for
-- other reasons, and fails for a developer who has been clicking around the
-- local dashboard — which is exactly what happened while this was being
-- written.
select bag_eq(
  $$ select user_id from public.activity_members
      where user_id in ('00000000-0000-4000-8000-0000000a0114',
                        '00000000-0000-4000-8000-0000000b0114',
                        '00000000-0000-4000-8000-0000000c0114',
                        '00000000-0000-4000-8000-0000000d0114') $$,
  $$ values ('00000000-0000-4000-8000-0000000a0114'::uuid),
            ('00000000-0000-4000-8000-0000000b0114'::uuid),
            ('00000000-0000-4000-8000-0000000c0114'::uuid) $$,
  'the three members are all listed and the viewer is left out');

reset role;

select * from finish();
rollback;
