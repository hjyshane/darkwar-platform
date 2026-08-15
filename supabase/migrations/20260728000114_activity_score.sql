-- 0114: what a member did this week, as a number.
--
-- Four things score: signing in (1), opening each of the three ranking boards
-- (0.5 each), and writing a comment (2). The first four are capped at once a
-- day; comments are not, because writing one is the effort the score is
-- actually trying to notice.
--
-- WHY TWO SOURCES RATHER THAN ONE EVENT LOG. Comments are counted from
-- `post_comments` and never written here. An event row would be a second,
-- unfalsifiable record of the same fact: it would survive the comment being
-- deleted (which this alliance decided should cost the points), and it could
-- be written by a client that never commented at all. The rule is that a fact
-- with a table of its own is read from that table. Logins and page opens have
-- no such table, so they get one here.
--
-- THIS IS SELF-REPORTED AND THAT IS ACCEPTABLE, but only because it is
-- bounded. A member's client writes their own rows, so a determined member
-- could POST them by hand — but the daily uniqueness below caps the whole
-- category at 1 + 0.5×3 = 2.5 points a day no matter how many requests they
-- send, and the only uncapped component is comments, which are real rows other
-- people can read. A participation score is not an authorisation decision; it
-- does not need to survive an adversary, it needs to not be farmable by
-- reloading a page.

-- The day, on the game's clock rather than the calendar's.
--
-- 02:00 UTC, the same offset `reset_week_start` uses, so that days nest inside
-- weeks exactly. On a plain UTC date a sign-in at 01:00 on Monday would fall
-- in a new DAY but the previous WEEK, and that member's Monday would silently
-- be worth two logins — one counted against last week's total and one against
-- this week's.
create function public.activity_day_of(ts timestamptz)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select (((ts at time zone 'UTC') - interval '2 hours'))::date
$$;

comment on function public.activity_day_of(timestamptz) is
  'The activity day a moment falls in, running 02:00 to 02:00 UTC. Shares its '
  'offset with reset_week_start so days nest inside game weeks — on a plain '
  'calendar date, Monday 00:00-02:00 would be a new day inside the old week.';

create table public.activity_events (
  user_id uuid not null references public.app_users (user_id) on delete cascade,

  -- Named rather than free text, for 0078's reason: two spellings of the same
  -- action would split the column in a week and the score would quietly halve.
  -- The three boards are the three in the nav that rank something.
  kind text not null check (
    kind in ('login', 'rank_server', 'rank_alliance', 'rank_player')
  ),

  occurred_at timestamptz not null default now(),

  -- Generated, not passed in. The client says WHEN something happened at most
  -- by its clock; which day that lands in is the database's rule, and a
  -- client-supplied day would let somebody spread one afternoon across a week.
  activity_day date not null generated always as (public.activity_day_of(occurred_at)) stored,

  -- ONCE A DAY, AS THE PRIMARY KEY ITSELF rather than as a check somewhere
  -- else. This is the entire anti-farming mechanism: a second sign-in, or a
  -- fiftieth visit to the alliance ranking, has nowhere to go. The client
  -- inserts on every visit and lets the key refuse the duplicates, which is
  -- the same bargain `post_reads` makes (0079).
  primary key (user_id, kind, activity_day)
);

comment on table public.activity_events is
  'One row per member per action per day: signing in, and opening each of the '
  'three ranking boards. Comments are NOT here — they are counted from '
  'post_comments, so that deleting one takes its points with it and so that '
  'the count cannot be written by a client that never commented.';

-- The score view reads a week of one member at a time, or a week of everybody.
create index activity_events_week_idx on public.activity_events (activity_day, user_id);

alter table public.activity_events enable row level security;

-- No UPDATE and no DELETE for anybody signed in. An event is something that
-- happened; there is no correcting it, and a member who could delete their own
-- rows could re-earn the day.
grant select, insert on public.activity_events to authenticated;
grant all on public.activity_events to service_role;

-- Your own day, and nobody writes anybody else's.
create policy self_insert on public.activity_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.current_app_role() in ('member', 'officer', 'admin')
  );

-- You see your own score; whoever administers members sees everybody's.
--
-- `members.manage` rather than the admin role, for 0045's reason and because
-- the boards' own gates were just corrected the same way: an officer handed
-- member administration from the permission grid should get this screen
-- without a migration.
create policy self_read on public.activity_events
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy manage_read on public.activity_events
  for select to authenticated
  using (public.has_permission('members.manage'));

-- THE SCORE.
--
-- A view of the CURRENT week only. The admin screen asks "who has shown up
-- this week", and a view answers that without a parameter; earlier weeks are
-- still there in `activity_events` and `post_comments` for anybody who wants
-- to write the query. A set-returning function taking a week would have to be
-- DEFINER to be worth anything, and 0105 is the standing warning about what
-- that costs on hosted Supabase.
--
-- `security_invoker = true`, AND IT IS LOAD-BEARING RATHER THAN DECORATIVE.
-- The gate on this view is not written here at all: it is the source tables'
-- own RLS, which already answers the question correctly per reader — a
-- member's policies show them their own rows, a `members.manage` holder's show
-- them everybody's. Without this option the view would default to DEFINER,
-- read `activity_events`, `post_comments` and `app_users` as the owner, and
-- hand every member the whole alliance's participation table.
--
-- That is not hypothetical: this migration was first written with the comment
-- above and without the option, and `58_relation_reach_test` is what caught
-- it. The test exists because `alliance_growth` shipped DEFINER by omission
-- once already.
--
-- The cost is the per-row `current_app_role()` the tables were always going to
-- charge. This is a handful of rows per member per week; it is not the shape
-- 0100-0107 were about.
create view public.activity_scores with (security_invoker = true) as
with week as (
  select public.reset_week_start(now()) as started_at
),
events as (
  select
    e.user_id,
    count(*) filter (where e.kind = 'login') as login_days,
    count(*) filter (where e.kind = 'rank_server') as server_days,
    count(*) filter (where e.kind = 'rank_alliance') as alliance_days,
    count(*) filter (where e.kind = 'rank_player') as player_days
  from public.activity_events e, week w
  where e.occurred_at >= w.started_at
  group by e.user_id
),
comments as (
  -- Live comments only. This alliance decided a deleted comment takes its
  -- points with it, which is the reason the count is derived here rather than
  -- logged as an event — a logged one would have kept them.
  select c.author_user_id as user_id, count(*) as comment_count
  from public.post_comments c, week w
  where c.created_at >= w.started_at
    and c.deleted_at is null
    and c.author_user_id is not null
  group by c.author_user_id
)
select
  u.user_id,
  (select started_at from week) as week_start,
  -- The character, the same way every other screen names somebody. Falls back
  -- to the account's display name and then to null, which the screen prints as
  -- a dash rather than calling anybody unknown (0113).
  coalesce(p.current_name, u.display_name) as display_name,
  coalesce(e.login_days, 0) as login_days,
  coalesce(e.server_days, 0) as server_days,
  coalesce(e.alliance_days, 0) as alliance_days,
  coalesce(e.player_days, 0) as player_days,
  coalesce(c.comment_count, 0) as comment_count,
  -- The weights, written once. Kept as literals rather than a settings table
  -- because nobody asked to tune them, and a score whose rules change silently
  -- between two readings of the same screen is worse than one that needs a
  -- migration to change.
  coalesce(e.login_days, 0) * 1.0 as login_points,
  (coalesce(e.server_days, 0) + coalesce(e.alliance_days, 0) + coalesce(e.player_days, 0))
    * 0.5 as ranking_points,
  coalesce(c.comment_count, 0) * 2.0 as comment_points,
  coalesce(e.login_days, 0) * 1.0
    + (coalesce(e.server_days, 0) + coalesce(e.alliance_days, 0) + coalesce(e.player_days, 0))
      * 0.5
    + coalesce(c.comment_count, 0) * 2.0 as total_points
from public.app_users u
left join public.players p on p.player_id = u.player_id
left join events e on e.user_id = u.user_id
left join comments c on c.user_id = u.user_id
-- Members and above. A viewer has not been admitted and can do none of the
-- four things, so a row of zeroes against their name is noise on the screen.
where u.role in ('member', 'officer', 'admin');

comment on view public.activity_scores is
  'This game week''s participation score per member: 1 point a day for signing '
  'in, 0.5 a day for each ranking board opened, 2 for each live comment. Shows '
  'the caller their own row, or everybody''s to a members.manage holder — the '
  'gate is the source tables'' own RLS, not a check in here.';

grant select on public.activity_scores to authenticated;
