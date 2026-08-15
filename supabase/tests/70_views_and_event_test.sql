-- 0119-0120: counting opens, and publishing event standings.
--
-- The §20.2 negatives here are unusual because the two features pull opposite
-- ways, and getting either backwards is the whole risk:
--
--   `post_views` must refuse a VIEWER and refuse a DRAFT — otherwise it is an
--   endpoint for running up numbers and for confirming that an unpublished
--   post exists.
--
--   `event_scoreboard` must SHOW a member everybody, which is the reverse of
--   every other test in this suite. It is a DEFINER view and its only gate is
--   a WHERE clause, so the negative that matters is the viewer: if that gate
--   is wrong, the alliance's standings are readable by anybody with an
--   account.
--
-- The positives sit beside them for 0055's reason, and here they do real work:
-- a scoreboard that refused everybody would pass a naive negative perfectly.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0119', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'views-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0119', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'views-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000c0119', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'views-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0119', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'views-viewer@test.invalid');

insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-000000010119', 580, 9900000000000119, 'Racer');

insert into public.app_users (user_id, role, player_id, display_name) values
  ('00000000-0000-4000-8000-0000000a0119', 'admin', null, 'TheAdmin'),
  ('00000000-0000-4000-8000-0000000b0119', 'member',
   '00000000-0000-4000-8000-000000010119', 'not-the-character'),
  ('00000000-0000-4000-8000-0000000c0119', 'member', null, 'TheOther'),
  ('00000000-0000-4000-8000-0000000d0119', 'viewer', null, 'TheViewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000000a0119');
insert into public.guides (guide_id, title, body, category, published_at) values
  ('00000000-0000-4000-8000-000000020119', 'Open', 'x', 'tip', now()),
  ('00000000-0000-4000-8000-000000030119', 'Draft', 'x', 'tip', null);

-- ---------------------------------------------------------------------------
-- 0119 — COUNTING OPENS
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0119');
select lives_ok(
  $$ select public.record_post_view(p_guide_id => '00000000-0000-4000-8000-000000020119') $$,
  'a member opening a post records a view');

-- EVERY OPEN COUNTS, which is what separates this from post_reads. The same
-- member opening it again is a second view, not a no-op.
select public.record_post_view(p_guide_id => '00000000-0000-4000-8000-000000020119');

select is(
  (select total_views from public.post_view_stats
    where guide_id = '00000000-0000-4000-8000-000000020119'),
  2::bigint,
  'and re-opening it counts again rather than being ignored');

-- Today is inside the seven-day window by definition, so recent equals total
-- until something ages out.
select is(
  (select recent_views from public.post_view_stats
    where guide_id = '00000000-0000-4000-8000-000000020119'),
  2::bigint,
  'both of which are recent today');

-- The window is real: an old day counts towards the total and not towards
-- "hot". Written as the table owner because the function only ever writes
-- today.
reset role;
insert into public.post_views (guide_id, view_day, views)
values ('00000000-0000-4000-8000-000000020119',
        public.activity_day_of(now()) - 30, 50);
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0119');

select is(
  (select total_views from public.post_view_stats
    where guide_id = '00000000-0000-4000-8000-000000020119'),
  52::bigint,
  'a month-old day still counts towards the total');

select is(
  (select recent_views from public.post_view_stats
    where guide_id = '00000000-0000-4000-8000-000000020119'),
  2::bigint,
  'but not towards the last seven days, which is what hot is scored on');

-- THE DRAFT NEGATIVE. A call that errored on a draft would confirm it exists;
-- one that counted would be its author proofreading.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0119');
select lives_ok(
  $$ select public.record_post_view(p_guide_id => '00000000-0000-4000-8000-000000030119') $$,
  'opening a draft is not an error');

select is(
  (select count(*) from public.post_views
    where guide_id = '00000000-0000-4000-8000-000000030119'),
  0::bigint,
  'but records nothing at all');

-- THE VIEWER NEGATIVE. Somebody never admitted must not be able to run the
-- numbers up.
select pg_temp.act_as('00000000-0000-4000-8000-0000000d0119');
select lives_ok(
  $$ select public.record_post_view(p_guide_id => '00000000-0000-4000-8000-000000020119') $$,
  'a viewer calling it is not an error either');

select is(
  (select count(*) from public.post_views),
  0::bigint,
  'records nothing, and they cannot even read the counts');

-- The positive beside it: the member still sees the real figures.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0119');
select is(
  (select total_views from public.post_view_stats
    where guide_id = '00000000-0000-4000-8000-000000020119'),
  52::bigint,
  'while a member reads them');

-- THE COUNTER IS NOT WRITABLE BY HAND. A view count somebody can set is not a
-- view count.
select throws_ok(
  $$ update public.post_views set views = 9999 $$,
  '42501',
  NULL,
  'and nobody can write the counter directly');

select throws_ok(
  $$ insert into public.post_views (guide_id, view_day, views)
     values ('00000000-0000-4000-8000-000000020119', current_date, 9999) $$,
  '42501',
  NULL,
  'nor insert a day of their own');

-- ---------------------------------------------------------------------------
-- 0120 — THE EVENT SCOREBOARD
-- ---------------------------------------------------------------------------

-- Two entrants inside the window and one day outside it. Written as the owner
-- because the point is to place rows on specific past days.
reset role;
insert into public.activity_events (user_id, kind, occurred_at) values
  -- Racer: two days inside the window.
  ('00000000-0000-4000-8000-0000000b0119', 'login', '2026-08-15T09:00:00Z'),
  ('00000000-0000-4000-8000-0000000b0119', 'rank_server', '2026-08-16T09:00:00Z'),
  -- TheOther: one day inside.
  ('00000000-0000-4000-8000-0000000c0119', 'login', '2026-08-22T09:00:00Z'),
  -- And one the day AFTER it closes, which must not count. 23 Aug 02:00 is
  -- the first moment of activity day 2026-08-23.
  ('00000000-0000-4000-8000-0000000c0119', 'rank_player', '2026-08-23T09:00:00Z'),
  -- The admin scores nothing inside the window at all.
  ('00000000-0000-4000-8000-0000000a0119', 'login', '2026-09-01T09:00:00Z');
set local role authenticated;

-- THE POSITIVE THAT MATTERS: a member sees everybody. This is the reverse of
-- the activity table and it is the whole point of the feature.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0119');
select is(
  (select count(*) from public.event_scoreboard),
  2::bigint,
  'a member sees every entrant, not just themselves');

-- 1 (login) + 0.5 (one board) = 1.5, and the name is the character.
select is(
  (select points from public.event_scoreboard where display_name = 'Racer'),
  1.5::numeric,
  'scored on the character''s name, not the account''s');

-- The day after the window closes does not count — that member has one login
-- inside and one board open outside.
select is(
  (select points from public.event_scoreboard where display_name = 'TheOther'),
  1.0::numeric,
  'and activity after 23 Aug 02:00 is outside the event');

-- ENTRANTS ONLY. A front page listing everybody who did not turn up is a
-- different, meaner feature.
select is(
  (select count(*) from public.event_scoreboard where display_name = 'TheAdmin'),
  0::bigint,
  'somebody who scored nothing in the window is not on the board');

-- THE NEGATIVE. The gate is a WHERE clause on a DEFINER view; if it is wrong,
-- the standings are public.
select pg_temp.act_as('00000000-0000-4000-8000-0000000d0119');
select is(
  (select count(*) from public.event_scoreboard),
  0::bigint,
  'a viewer sees no standings at all');

-- Anon is refused by the GRANT, before the WHERE clause is even reached —
-- a stronger answer than an empty result, and asserted as the error it
-- actually is rather than as zero rows.
reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.event_scoreboard $$,
  '42501',
  NULL,
  'and an anonymous request cannot read it at all');

reset role;

select * from finish();
rollback;
