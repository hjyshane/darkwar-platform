-- 0069: growth for a player nobody measured on schedule, and the address an
-- account signed up with.
--
-- Two unrelated gaps, one migration because both are small views and both
-- exist to make the admin screen able to do its job.
--
-- ---------------------------------------------------------------------------
-- 1. Growth without a fixed interval.
--
-- `player_power_growth` compares against the newest snapshot at least a day
-- and a week old, measured at 02:05 UTC (0055). That is the right shape for
-- our own members, who are captured on a schedule. It is the wrong shape for
-- everyone else: a player from another alliance is seen when somebody happens
-- to open their profile, so both baselines are usually null and the screen
-- shows a dash for a player we have two readings of.
--
-- This view asks the weaker question that can actually be answered — the
-- previous reading, whenever it was — and returns its timestamp so the screen
-- can say over what. Not a replacement: "grew 3% since some unspecified
-- moment" is worse than "grew 3% in a day" when the second is available, so
-- both exist and the caller prefers the interval one.
--
-- security_invoker, like every view over player_snapshots: the snapshots are
-- member-only and a view is not a way to read past that.
create view public.player_growth_recent
with (security_invoker = true) as
with ranked as (
  select
    player_id,
    power,
    captured_at,
    row_number() over (partition by player_id order by captured_at desc) as position
  from public.player_snapshots
  where player_id is not null and power is not null
)
select
  latest.player_id,
  latest.power,
  latest.captured_at as power_at,
  previous.power as power_prev,
  previous.captured_at as power_prev_at,
  -- Whole seconds. The screen renders this as "in 4 days" or "in 3 hours",
  -- and an interval is what Postgres already knows how to subtract.
  latest.captured_at - previous.captured_at as span,
  -- Null on a missing or zero baseline rather than zero or a division by it:
  -- "no growth", "no baseline" and "cannot be computed" are three answers
  -- and must not share a rendering (FR-UI-008).
  case
    when previous.power is null or previous.power = 0 then null
    else (latest.power - previous.power)::numeric / previous.power * 100
  end as growth_since_last
from ranked as latest
left join ranked as previous
  on previous.player_id = latest.player_id and previous.position = 2
where latest.position = 1;

comment on view public.player_growth_recent is
  'Power against the PREVIOUS reading, whatever interval that was, with its '
  'timestamp and the span between them. For players nobody captures on a '
  'schedule — anyone outside our alliance — where the fixed 1d/7d baselines '
  'in player_power_growth are almost always null.';

grant select on public.player_growth_recent to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Which address an account signed up with.
--
-- `app_users` has never held one: the email lives in `auth.users`, which no
-- client may read. So the members screen lists accounts by display_name, and
-- a display_name is whatever the person typed — usually null. An admin
-- looking at four unnamed rows cannot tell which is whose, cannot match one
-- to the person who asked for a code, and cannot remove the right one.
--
-- SECURITY DEFINER, and this one genuinely needs saying: it reads auth.users,
-- which is not in the API schema at all. So the gate is the predicate, and it
-- is `members.manage` rather than a role name — this is administration of
-- accounts, exactly what that capability is for, and 0045 put the same
-- capability on every write to app_users.
--
-- Emails are the most personal thing in this database. Nothing but this view
-- exposes them, it exposes no other auth column (no password hash, no tokens,
-- no confirmation links), and it is granted to authenticated only so the
-- predicate is what decides.
create view public.app_user_directory as
select
  u.user_id,
  u.role,
  u.game_rank,
  u.display_name,
  u.player_id,
  u.created_at,
  a.email,
  a.email_confirmed_at,
  a.last_sign_in_at
from public.app_users u
join auth.users a on a.id = u.user_id
where public.has_permission('members.manage');

comment on view public.app_user_directory is
  'app_users with the address each account signed up under, for the members '
  'screen. SECURITY DEFINER because auth.users is not client-readable at '
  'all; gated on members.manage in the predicate. The only place in this '
  'schema that exposes an email, and it exposes nothing else from auth.';

grant select on public.app_user_directory to authenticated;
