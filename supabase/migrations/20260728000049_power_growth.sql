-- 0049: how much a member's power has moved, day over day and week over week.
--
-- The figure people actually manage by is not power, it is whether power is
-- going up. The roster showed a number with nothing to compare it to.
--
-- Computed in a view rather than stored: it is a question about two rows of
-- player_snapshots, and storing the answer would mean recomputing it every
-- time a snapshot lands and getting it wrong whenever one arrives late.
--
-- security_invoker so the caller's own policies decide what they see —
-- player_snapshots is member-only, and a view that read it with the owner's
-- rights would hand a logged-out visitor every member's power history.
--
-- The baseline is "the newest snapshot at or before the cutoff", not "the
-- snapshot nearest the cutoff". A collector that has not run for five days
-- leaves a five-day-old baseline, and calling that a daily change would be a
-- lie; the view returns the baseline's timestamp alongside so the screen can
-- say what it actually compared against.
--
-- It must also be a DIFFERENT snapshot from the latest one. With a single
-- capture in the database the cutoff matches that very row, and every member
-- comes out at exactly 0% — an unknown wearing the one value FR-UI-008 says
-- it must never wear. Caught by looking: 150 of 150 read 0.00%.
create view public.player_power_growth
with (security_invoker = true) as
with latest as (
  select distinct on (player_id)
    player_id, power, captured_at
  from public.player_snapshots
  where player_id is not null and power is not null
  order by player_id, captured_at desc
),
daily as (
  select distinct on (snapshot.player_id)
    snapshot.player_id, snapshot.power, snapshot.captured_at
  from public.player_snapshots as snapshot
  join latest using (player_id)
  where snapshot.power is not null
    and snapshot.captured_at <= now() - interval '1 day'
    and snapshot.captured_at < latest.captured_at
  order by snapshot.player_id, snapshot.captured_at desc
),
weekly as (
  select distinct on (snapshot.player_id)
    snapshot.player_id, snapshot.power, snapshot.captured_at
  from public.player_snapshots as snapshot
  join latest using (player_id)
  where snapshot.power is not null
    and snapshot.captured_at <= now() - interval '7 days'
    and snapshot.captured_at < latest.captured_at
  order by snapshot.player_id, snapshot.captured_at desc
)
select
  latest.player_id,
  latest.power as power,
  daily.power as power_1d,
  daily.captured_at as power_1d_at,
  weekly.power as power_7d,
  weekly.captured_at as power_7d_at,
  -- Null rather than zero when there is nothing to compare against, and
  -- null on a zero baseline rather than a division by it: "no growth" and
  -- "no baseline" are different answers and must not share a rendering.
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
  'Power now against the newest snapshot at least a day / a week old. The '
  'baseline timestamps come with it because a stale collector makes "daily" '
  'mean something else, and the screen has to be able to say so.';

grant select on public.player_power_growth to anon, authenticated;
