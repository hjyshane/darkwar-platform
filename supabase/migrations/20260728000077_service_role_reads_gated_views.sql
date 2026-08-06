-- 0077: the collector can read its own alliance views.
--
-- `dw-notify` runs with the service key, like every other collector process. That
-- key bypasses RLS — but these four are DEFINER views with the role check written
-- into the WHERE clause, and a WHERE clause is not RLS. Nothing bypasses it.
--
-- So `alliance_departures` returned zero rows to the notifier and departures could
-- never be announced. Not a permission error, not a warning: an empty list, which
-- is exactly what "nobody has left" looks like. It was found by enabling the event
-- and watching nothing happen.
--
-- `current_app_role()` reads `app_users` by `auth.uid()`, and a service-key request
-- has no user, so it falls through to `'viewer'`. That is right for a browser and
-- wrong for the collector.
--
-- WHY NOT LET THE WORKER READ THE BASE TABLES INSTEAD. It could — the service key
-- can select `alliance_member_snapshots` directly. But then "who has left" would
-- exist twice: once in 0067's view and once in Python, and the second copy would
-- have to re-derive the newest-batch rule and the `snapshot_complete` qualifier.
-- Two implementations of one rule is the thing this repo keeps paying for.
--
-- WHAT THIS DOES NOT CHANGE. `authenticated` requests run as `current_user =
-- 'authenticated'`, so the new disjunct is false for every browser — a member sees
-- exactly what they saw before, and a signed-in stranger still sees nothing.
-- 45_service_role_views_test asserts both, and asserts the collector's side works,
-- because a gate that refuses everybody passes every negative test ever written.
create function public.is_service_request() returns boolean
language sql
stable
as $$
  -- NOT security definer, deliberately: a definer function runs as its owner and
  -- `current_user` would then always be that owner. This has to see who is
  -- actually asking.
  --
  -- `current_user` rather than the JWT claims, because Supabase's newer secret
  -- keys are not JWTs and set no claims at all — PostgREST still does
  -- `set local role service_role` for them, which is what this reads.
  select current_user in ('service_role', 'supabase_admin', 'postgres')
$$;

comment on function public.is_service_request() is
  'True for a collector request made with the service key, false for every '
  'browser request. Used to widen the four alliance views whose role check is a '
  'WHERE clause rather than RLS, which nothing bypasses.';

grant execute on function public.is_service_request() to anon, authenticated;


-- alliance_roster_latest: unchanged apart from the predicate.
create or replace view public.alliance_roster_latest as
with newest as (
  select alliance_id, max(captured_at) as captured_at
  from public.alliance_member_snapshots
  group by alliance_id
),
sized as (
  select
    s.alliance_id,
    s.captured_at,
    count(*) as observed_members
  from public.alliance_member_snapshots s
  join newest n
    on n.alliance_id = s.alliance_id and n.captured_at = s.captured_at
  group by s.alliance_id, s.captured_at
)
select
  s.snapshot_id,
  s.alliance_id,
  s.server_id,
  s.player_id,
  s.game_uid,
  s.name,
  s.member_rank,
  s.hq_level,
  s.power,
  s.kills,
  s.captured_at,
  sized.observed_members,
  a.member_count as expected_members,
  -- Null expectation is not a failed check: an alliance we have never seen
  -- a member count for is simply unmeasured, and calling that "incomplete"
  -- would mark every departure unconfirmed forever.
  (a.member_count is null or sized.observed_members >= a.member_count)
    as snapshot_complete
from public.alliance_member_snapshots s
join sized
  on sized.alliance_id = s.alliance_id and sized.captured_at = s.captured_at
join public.alliances a on a.alliance_id = s.alliance_id
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request());


-- alliance_departures: unchanged apart from the predicate.
create or replace view public.alliance_departures as
with newest as (
  select alliance_id, max(captured_at) as captured_at
  from public.alliance_member_snapshots
  group by alliance_id
),
current_members as (
  select s.alliance_id, s.game_uid
  from public.alliance_member_snapshots s
  join newest n
    on n.alliance_id = s.alliance_id and n.captured_at = s.captured_at
),
history as (
  select
    s.alliance_id,
    s.game_uid,
    max(s.captured_at) as last_seen_in_alliance_at,
    min(s.captured_at) as first_seen_in_alliance_at
  from public.alliance_member_snapshots s
  group by s.alliance_id, s.game_uid
)
select distinct on (h.alliance_id, h.game_uid)
  h.alliance_id,
  h.game_uid,
  s.player_id,
  s.name as last_known_name,
  s.member_rank as last_member_rank,
  s.hq_level as last_hq_level,
  s.power as last_power,
  s.kills as last_kills,
  h.first_seen_in_alliance_at,
  h.last_seen_in_alliance_at,
  n.captured_at as roster_captured_at,
  -- The same qualifier the roster view carries, repeated here because this
  -- is where a reader acts on it: false means "absent from a capture that
  -- did not see the whole list", which is a maybe, not a departure.
  r.snapshot_complete as confirmed
from history h
join newest n on n.alliance_id = h.alliance_id
join public.alliance_member_snapshots s
  on s.alliance_id = h.alliance_id
 and s.game_uid = h.game_uid
 and s.captured_at = h.last_seen_in_alliance_at
join lateral (
  select bool_and(rl.snapshot_complete) as snapshot_complete
  from public.alliance_roster_latest rl
  where rl.alliance_id = h.alliance_id
) r on true
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
  and not exists (
    select 1 from current_members c
    where c.alliance_id = h.alliance_id and c.game_uid = h.game_uid
  )
order by h.alliance_id, h.game_uid, h.last_seen_in_alliance_at desc;


-- alliance_roster_history: unchanged apart from the predicate.
create or replace view public.alliance_roster_history as
select
  s.alliance_id,
  s.captured_at,
  count(*) as observed_members,
  a.member_count as expected_members,
  (a.member_count is null or count(*) >= a.member_count) as snapshot_complete,
  sum(s.power) as total_power,
  round(avg(s.power)) as avg_power,
  percentile_cont(0.5) within group (order by s.power) as median_power,
  max(s.power) as max_power,
  round(avg(s.hq_level)::numeric, 2) as avg_hq_level,
  max(s.hq_level) as max_hq_level,
  -- Counted rather than averaged: "how many are at the cap" is the question an
  -- officer actually asks about tower levels, and a mean hides it.
  count(*) filter (where s.hq_level >= 35) as members_at_hq35,
  sum(s.kills) as total_kills,
  count(*) filter (where s.member_rank >= 4) as officers,
  count(*) filter (where s.presence_redacted) as presence_unknown
from public.alliance_member_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
group by s.alliance_id, s.captured_at, a.member_count;


-- alliance_daily_contribution: unchanged apart from the predicate.
create or replace view public.alliance_daily_contribution as
with roster as (
  select distinct alliance_id, game_uid
  from public.alliance_member_snapshots
),
best as (
  select
    r.alliance_id,
    -- The game day this capture belongs to, as its 02:00 UTC start.
    date_trunc('day', s.captured_at - interval '2 hours') + interval '2 hours' as game_day,
    s.contribution_type as kind,
    s.game_uid,
    max(s.score) as score,
    max(s.captured_at) as last_capture_at,
    count(*) as readings
  from public.alliance_contribution_snapshots s
  join roster r on r.game_uid = s.game_uid
  where s.score is not null
  group by 1, 2, 3, 4
)
select
  alliance_id,
  game_day,
  kind,
  sum(score) as total,
  count(*) as members_counted,
  round(avg(score)) as avg_per_member,
  max(last_capture_at) as last_capture_at,
  -- More than one reading of the same board on the same day means the total is
  -- the end of the day rather than a moment in it. Worth carrying: on a day read
  -- once, early, the figure is a partial day and looks like a bad day.
  max(readings) as readings
from best
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
group by alliance_id, game_day, kind;
