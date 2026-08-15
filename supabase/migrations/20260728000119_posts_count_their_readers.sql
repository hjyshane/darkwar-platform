-- 0119: how many times a post has been opened.
--
-- COUNTED PER DAY, NOT AS ONE RUNNING TOTAL, and that is what makes "hot"
-- possible. A single `views` integer answers "how many ever" and nothing else;
-- the boards also want "busy this week", and no amount of arithmetic recovers
-- a window from a lone counter. One row per post per day is bounded by posts ×
-- days rather than by opens, so it stays small while answering both.
--
-- THIS IS A COUNT OF OPENS, NOT OF PEOPLE. `post_reads` (0079) already knows
-- who has read what and is deliberately private — that migration refused to
-- answer "who has read my notice" on the grounds that it turns a reading aid
-- into surveillance. Nothing here reads that table or names anybody: these
-- rows carry a post, a date and a number, and re-opening a post you have
-- already read increments it exactly as somebody else's first visit does.
create table public.post_views (
  guide_id uuid references public.guides (guide_id) on delete cascade,
  announcement_id uuid
    references public.announcements (announcement_id) on delete cascade,

  -- The same 02:00 day the activity score uses (0114), so "the last 7 days"
  -- means one thing across the whole dashboard rather than two.
  view_day date not null,

  views bigint not null default 0,

  constraint post_views_exactly_one_target check (
    (guide_id is not null)::int + (announcement_id is not null)::int = 1
  )
);

comment on table public.post_views is
  'Opens per post per day. Per-day rather than one running total so that '
  '"busy this week" is answerable — a single counter cannot be windowed. '
  'Counts opens, not people: post_reads knows who, and stays private (0079).';

-- Partial uniques, the shape this schema uses whenever the target is one of
-- two nullable columns (0022, 0079): a plain unique over both would let the
-- same post and day appear twice.
create unique index post_views_guide_day_uniq
  on public.post_views (guide_id, view_day) where guide_id is not null;
create unique index post_views_announcement_day_uniq
  on public.post_views (announcement_id, view_day) where announcement_id is not null;

alter table public.post_views enable row level security;

-- READABLE BY THE ALLIANCE, WRITABLE BY NOBODY DIRECTLY. The only writer is
-- the function below: a table members could UPDATE is a counter members could
-- set to anything, and a view count somebody can type in is not a view count.
grant select on public.post_views to authenticated;
grant all on public.post_views to service_role;

create policy member_read on public.post_views
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- Recording an open.
--
-- A FUNCTION RATHER THAN AN INSERT POLICY, for two reasons. The write is an
-- upsert-and-increment, which a client would have to do in two round trips
-- with a race in the middle; and the guard below has to run somewhere the
-- caller cannot skip.
--
-- THE GUARD IS THE POINT. Without it this is an endpoint that (a) lets a
-- viewer who was never admitted run up numbers, and (b) confirms whether a
-- draft exists by whether the call succeeds. Drafts are excluded outright:
-- an unpublished post has no audience yet, so a view count on one would be
-- the author's own proofreading.
create function public.record_post_view(
  p_guide_id uuid default null,
  p_announcement_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.activity_day_of(now());
begin
  if public.current_app_role() not in ('member', 'officer', 'admin') then
    return;
  end if;

  if (p_guide_id is not null)::int + (p_announcement_id is not null)::int <> 1 then
    raise exception 'a view belongs to exactly one post'
      using errcode = 'check_violation';
  end if;

  if p_guide_id is not null then
    if not exists (
      select 1 from public.guides
       where guide_id = p_guide_id and published_at is not null
    ) then
      return;
    end if;
    insert into public.post_views (guide_id, view_day, views)
    values (p_guide_id, today, 1)
    on conflict (guide_id, view_day) where guide_id is not null
      do update set views = public.post_views.views + 1;
  else
    if not exists (
      select 1 from public.announcements
       where announcement_id = p_announcement_id and published_at is not null
    ) then
      return;
    end if;
    insert into public.post_views (announcement_id, view_day, views)
    values (p_announcement_id, today, 1)
    on conflict (announcement_id, view_day) where announcement_id is not null
      do update set views = public.post_views.views + 1;
  end if;
end;
$$;

comment on function public.record_post_view(uuid, uuid) is
  'Increment today''s open count for one post. The only writer of post_views. '
  'Silently does nothing for a viewer or an unpublished post — a draft''s '
  'count would be its author proofreading, and a call that errored on one '
  'would confirm the draft exists.';

-- 0095 and 0096's rule, both halves. `public` alone misses the platform's
-- direct grants; naming the roles alone misses the PUBLIC default.
revoke all on function public.record_post_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_post_view(uuid, uuid) to authenticated;

-- What the boards actually read: one row per post, all-time and recent.
--
-- `security_invoker` so the member_read policy above decides who sees it,
-- rather than this view quietly answering for everybody.
create view public.post_view_stats with (security_invoker = true) as
select
  v.guide_id,
  v.announcement_id,
  sum(v.views)::bigint as total_views,
  -- The window "hot" is scored on. Seven days of the same 02:00 day the rest
  -- of the dashboard counts in.
  sum(v.views) filter (
    where v.view_day > public.activity_day_of(now()) - 7
  )::bigint as recent_views
from public.post_views v
group by v.guide_id, v.announcement_id;

comment on view public.post_view_stats is
  'Opens per post: all time, and in the last seven days. The recent figure is '
  'what "hot" is scored on — it exists because a single running total cannot '
  'be windowed after the fact.';

grant select on public.post_view_stats to authenticated;
