-- 0118: the same score, over whatever period you ask for.
--
-- 0114 answered one question — "this game week" — and answered it in a view,
-- which is why it needed no parameter and could stay `security_invoker`. The
-- screen now needs any range, defaulting to all time, and a view still cannot
-- take an argument.
--
-- THE WAY OUT IS NOT A FUNCTION. `activity_scores(from, to)` would have to be
-- SECURITY DEFINER to be worth writing, and 0105 plus 0114's own near-miss are
-- what that costs: on hosted Supabase a definer routine does not shed RLS, it
-- just moves the gate somewhere a reviewer has to go looking for it.
--
-- So the view stops aggregating over a period and starts emitting one row per
-- member per DAY. Any range is then a filter on `day` — including a game week,
-- so 0114's original question is still one `where` clause away — and the
-- totalling moves to the screen, which is where the range is chosen anyway.
--
-- UNION ALL, NOT A FULL JOIN. The obvious shape is events full-joined to
-- comments on (user, day) with COALESCE picking the key, and that is precisely
-- the shape 0105 could not fix: a key that is a COALESCE of both sides has no
-- single column for a filter to push down to, so `day >= x` would be evaluated
-- after the whole thing was built. Stacking the two sources and grouping once
-- keeps `user_id` and `day` real columns.
drop view public.activity_scores;

create view public.activity_daily with (security_invoker = true) as
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

  -- Live comments only, still: this alliance decided a deleted comment takes
  -- its points with it, which is why the count is derived here rather than
  -- logged as an event (0114).
  --
  -- Dated by the same 02:00 rule the events use, so a comment written at 01:00
  -- on Monday lands in the day and week the rest of that evening did.
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
  -- The weights, still literals and still in one place. A day is worth at most
  -- one login and one open of each board (the primary key on activity_events
  -- sees to that), so these sums are 0 or 1 per row except for comments.
  sum(logins) * 1.0
    + (sum(server_opens) + sum(alliance_opens) + sum(player_opens)) * 0.5
    + sum(comments) * 2.0 as points
from sources
group by user_id, day;

comment on view public.activity_daily is
  'One row per member per day with any activity: sign-in, each ranking board '
  'opened, live comments written, and what that day is worth. Per-day rather '
  'than per-period so the screen can total any range — a game week is one '
  'filter on `day`. security_invoker, so the source tables'' own RLS decides '
  'whether you see your own row or everybody''s.';

grant select on public.activity_daily to authenticated;

-- WHO TO LIST, including the people with nothing to show.
--
-- `activity_daily` has no row for a member who has done nothing, and those are
-- exactly the members the screen exists to find — a table that silently omits
-- them answers the opposite of the question. This is the name list to join
-- against, and it carries the same gate by carrying the same source: a member
-- reads their own `app_users` row, a `members.manage` holder reads everybody's.
create view public.activity_members with (security_invoker = true) as
select
  u.user_id,
  -- The character, else the account's display name, else null — the screen
  -- prints a dash rather than calling anybody unknown (0113).
  coalesce(p.current_name, u.display_name) as display_name
from public.app_users u
left join public.players p on p.player_id = u.player_id
-- A viewer can do none of the four things, so a row of zeroes against their
-- name is noise (0114 drew the same line).
where u.role in ('member', 'officer', 'admin');

comment on view public.activity_members is
  'Members eligible for an activity score, with the name to print. Separate '
  'from activity_daily because somebody who has done nothing has no daily '
  'rows, and they are the ones the screen is looking for.';

grant select on public.activity_members to authenticated;
