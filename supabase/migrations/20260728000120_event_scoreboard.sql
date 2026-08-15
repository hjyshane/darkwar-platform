-- 0120: the event scoreboard, on the front page for everybody.
--
-- THIS DELIBERATELY PUBLISHES WHAT 0114 KEPT PRIVATE, and the difference is
-- consent. The admin table is a record of who is paying attention, shown only
-- to whoever manages members, because nobody signed up to have their attention
-- ranked. An EVENT is the opposite: people enter it knowing there is a
-- scoreboard, and a scoreboard only one person can see is not one.
--
-- So the exposure is cut to the bone. This view carries a NAME and a NUMBER
-- and nothing else — no per-day rows, no breakdown of which boards somebody
-- opened, no zero-scored members. Whether a member signed in on Tuesday stays
-- exactly as private as it was.
--
-- IT READS THE BASE TABLES, NOT `activity_daily`, AND THAT IS NOT A STYLE
-- CHOICE. The first version of this migration selected from that view and
-- returned only the caller's own row. `security_invoker` does not mean "runs
-- as whoever owns the view that called me" — it means the permissions and RLS
-- of the SESSION USER, and an intervening DEFINER view does not reset that.
-- So a definer view built on an invoker view is still gated as the caller,
-- which is the exact opposite of what a scoreboard needs. Caught by this
-- migration's own test showing one entrant where two were seeded.
--
-- DEFINER (the default) IS THEREFORE CORRECT HERE, which is worth saying out
-- loud given 0114 shipped a bug by getting it backwards. `activity_daily` is
-- invoker precisely so a member sees only themselves; this must see everybody.
-- The gate moves into the WHERE clause instead — the same shape `post_authors`
-- (0079) uses, and the reason `58_relation_reach_test` accepts a view that
-- names `current_app_role`.
--
-- THE WINDOW IS HARD-CODED because the event has real dates: 15 Aug 02:00 UTC
-- to 23 Aug 01:59 UTC. Those are exactly activity days 2026-08-15 through
-- 2026-08-22 — the 02:00 boundary the score already counts on IS the event's
-- boundary, so no new date arithmetic is needed and none can drift from it.

-- The weights, in one place, because they are now needed in two.
--
-- Extracting them is the whole defence against the drift this migration would
-- otherwise introduce: `activity_daily` and the scoreboard have to agree about
-- what a comment is worth, and two copies of `* 2.0` in different files agree
-- only until somebody edits one.
create function public.activity_points(
  p_logins bigint,
  p_server bigint,
  p_alliance bigint,
  p_player bigint,
  p_comments bigint
)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(p_logins, 0) * 1.0
       + (coalesce(p_server, 0) + coalesce(p_alliance, 0) + coalesce(p_player, 0)) * 0.5
       + coalesce(p_comments, 0) * 2.0
$$;

comment on function public.activity_points(bigint, bigint, bigint, bigint, bigint) is
  'What a day of activity is worth: 1 a day for signing in, 0.5 for each '
  'ranking board opened, 2 for each live comment. One definition, because '
  'activity_daily and event_scoreboard both need it and two copies drift.';

-- `activity_daily` moves onto the shared function. Same columns, same types,
-- same numbers — this is a refactor, and 68's arithmetic assertions are what
-- say so.
create or replace view public.activity_daily with (security_invoker = true) as
with sources as (
  select
    e.user_id,
    e.activity_day as day,
    (e.kind = 'login')::int as logins,
    (e.kind = 'rank_server')::int as server_opens,
    (e.kind = 'rank_alliance')::int as alliance_opens,
    (e.kind = 'rank_player')::int as player_opens,
    0 as comments
  from public.activity_events e

  union all

  select
    c.author_user_id as user_id,
    public.activity_day_of(c.created_at) as day,
    0, 0, 0, 0,
    1
  from public.post_comments c
  where c.deleted_at is null
    and c.author_user_id is not null
)
select
  user_id,
  day,
  sum(logins)::bigint as login_days,
  sum(server_opens)::bigint as server_days,
  sum(alliance_opens)::bigint as alliance_days,
  sum(player_opens)::bigint as player_days,
  sum(comments)::bigint as comment_count,
  public.activity_points(
    sum(logins)::bigint,
    sum(server_opens)::bigint,
    sum(alliance_opens)::bigint,
    sum(player_opens)::bigint,
    sum(comments)::bigint
  ) as points
from sources
group by user_id, day;

create view public.event_scoreboard as
with sources as (
  select
    e.user_id,
    e.activity_day as day,
    (e.kind = 'login')::int as logins,
    (e.kind = 'rank_server')::int as server_opens,
    (e.kind = 'rank_alliance')::int as alliance_opens,
    (e.kind = 'rank_player')::int as player_opens,
    0 as comments
  from public.activity_events e
  where e.activity_day between date '2026-08-15' and date '2026-08-22'

  union all

  select
    c.author_user_id,
    public.activity_day_of(c.created_at),
    0, 0, 0, 0,
    1
  from public.post_comments c
  where c.deleted_at is null
    and c.author_user_id is not null
    and public.activity_day_of(c.created_at)
        between date '2026-08-15' and date '2026-08-22'
)
select
  coalesce(p.current_name, u.display_name) as display_name,
  public.activity_points(
    sum(s.logins)::bigint,
    sum(s.server_opens)::bigint,
    sum(s.alliance_opens)::bigint,
    sum(s.player_opens)::bigint,
    sum(s.comments)::bigint
  ) as points
from sources s
join public.app_users u on u.user_id = s.user_id
left join public.players p on p.player_id = u.player_id
where public.current_app_role() in ('member', 'officer', 'admin')
group by u.user_id, p.current_name, u.display_name
-- ENTRANTS ONLY. A member who did nothing is not on the leaderboard; the
-- admin table is where "who is missing" gets asked, and putting a column of
-- zeroes on the front page turns a scoreboard into a list of people who did
-- not turn up.
having public.activity_points(
    sum(s.logins)::bigint,
    sum(s.server_opens)::bigint,
    sum(s.alliance_opens)::bigint,
    sum(s.player_opens)::bigint,
    sum(s.comments)::bigint
  ) > 0;

comment on view public.event_scoreboard is
  'Event standings for 15-23 Aug 2026, for anybody in the alliance. Name and '
  'points only: the per-day detail behind it stays private to its owner. '
  'DEFINER on purpose — a scoreboard has to see everybody — with the member '
  'gate in the WHERE clause, the way post_authors does it. Reads the base '
  'tables rather than activity_daily, because an invoker view stays gated as '
  'the session user even when a definer view selects from it.';

grant select on public.event_scoreboard to authenticated;
