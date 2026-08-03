-- 0051: growth is measured at 02:05 UTC, not "whenever you looked".
--
-- 0049 compared the newest snapshot against the newest one at least a day
-- old. That answers a slightly different question than the one being asked:
-- it drifts through the day as captures land, so the same member's "daily
-- growth" changes between breakfast and dinner without their power moving.
--
-- The measurement point is now fixed — 02:05 UTC, five minutes after the
-- game week rolls over, which is the same cadence the rank report uses. The
-- columns hold still for a day at a time, and two readings a week apart are
-- genuinely a week apart rather than "a week and however long since the
-- collector last ran".
--
-- 02:05 rather than 02:00 for the reason the report has it: at 02:00 the
-- weekly boards are being wiped. Power is not one of them, but keeping one
-- measurement clock for both means there is one thing to get right.
--
-- Still "the newest snapshot AT OR BEFORE the point" rather than one taken
-- exactly at it: the collector cannot be relied on to have run at 02:05, and
-- the timestamps come back with the answer so the screen can say what it
-- actually compared.
-- Dropped rather than replaced: CREATE OR REPLACE VIEW can only append
-- columns, and power_at belongs beside the power it timestamps rather than
-- tacked on at the end.
drop view public.player_power_growth;

create view public.player_power_growth
with (security_invoker = true) as
with anchor as (
  -- The most recent 02:05 UTC at or before now.
  select (date_trunc('day', (now() at time zone 'UTC') - interval '2 hours 5 minutes')
          + interval '2 hours 5 minutes') at time zone 'UTC' as at
),
latest as (
  select distinct on (snapshot.player_id)
    snapshot.player_id, snapshot.power, snapshot.captured_at
  from public.player_snapshots as snapshot
  cross join anchor
  where snapshot.player_id is not null and snapshot.power is not null
    and snapshot.captured_at <= anchor.at
  order by snapshot.player_id, snapshot.captured_at desc
),
daily as (
  select distinct on (snapshot.player_id)
    snapshot.player_id, snapshot.power, snapshot.captured_at
  from public.player_snapshots as snapshot
  cross join anchor
  join latest on latest.player_id = snapshot.player_id
  where snapshot.power is not null
    and snapshot.captured_at <= anchor.at - interval '1 day'
    -- Must be a DIFFERENT snapshot from the latest. With one capture in the
    -- database the cutoff matches that very row and every member comes out
    -- at exactly 0.00% — an unknown wearing the one value FR-UI-008 says it
    -- must never wear. 150 of 150 read 0.00 before this line existed.
    and snapshot.captured_at < latest.captured_at
  order by snapshot.player_id, snapshot.captured_at desc
),
weekly as (
  select distinct on (snapshot.player_id)
    snapshot.player_id, snapshot.power, snapshot.captured_at
  from public.player_snapshots as snapshot
  cross join anchor
  join latest on latest.player_id = snapshot.player_id
  where snapshot.power is not null
    and snapshot.captured_at <= anchor.at - interval '7 days'
    and snapshot.captured_at < latest.captured_at
  order by snapshot.player_id, snapshot.captured_at desc
)
select
  latest.player_id,
  latest.power as power,
  latest.captured_at as power_at,
  daily.power as power_1d,
  daily.captured_at as power_1d_at,
  weekly.power as power_7d,
  weekly.captured_at as power_7d_at,
  case when daily.power is null or daily.power = 0 then null
       else (latest.power - daily.power)::numeric / daily.power * 100
  end as growth_1d,
  case when weekly.power is null or weekly.power = 0 then null
       else (latest.power - weekly.power)::numeric / weekly.power * 100
  end as growth_7d
from latest
left join daily using (player_id)
left join weekly using (player_id);

comment on view public.player_power_growth is
  'Power at the most recent 02:05 UTC, against the same point a day and a '
  'week earlier. Fixed measurement times so the figure holds still for a '
  'day; baseline timestamps come with it because the collector may not have '
  'run at the moment asked for.';
