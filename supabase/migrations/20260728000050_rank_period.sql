-- 0050: the two-week period ranks are decided over.
--
-- Built on reset_week_start rather than beside it. The period boundary IS a
-- game week boundary — Monday 02:00 UTC — just every other one, so deriving
-- it from the week rule means the two can never disagree about what a Monday
-- is. Adding hours arithmetic of its own would have been a second place for
-- the 02:00 to be wrong.
--
-- The epoch is 2026-07-27T02:00:00Z: a boundary the GAME named, reported as
-- its own week_start by user.get.arena.info. Picking a Monday out of the air
-- would have worked equally well and been impossible to check.
--
-- What gets measured, and when — the times matter because two of the three
-- figures are wiped by the reset:
--
--   contribution, weekly duel   01:59Z on the last day of each week, one
--                               minute before the game clears the boards.
--                               Two readings per period, summed.
--   power                       the period's own boundaries, 02:00Z. Power
--                               does not reset, so the boundary is a fine
--                               place to read it.
--
-- Reading either at 02:00 on the day the boards clear would have scored
-- everyone at zero, which is what made the timing worth writing down.
--
-- Vectors live in protocol-fixtures/rank-period/vectors.json and are checked
-- by 27_rank_period_test.sql and rankPeriod.test.ts. Python has no
-- implementation on purpose: nothing in the collector needs a period, and
-- one with no caller drifts without anybody noticing.
create function public.rank_period_start(ts timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = ''
as $$
  select timestamptz '2026-07-27 02:00:00+00'
       + ((weeks - ((weeks % 2 + 2) % 2)) * interval '7 days')
  from (
    select floor(
      extract(epoch from
        public.reset_week_start(ts) - timestamptz '2026-07-27 02:00:00+00'
      ) / 604800
    )::bigint as weeks
  ) as grid
$$;

comment on function public.rank_period_start(timestamptz) is
  'The two-week rank period containing ts, as its starting Monday 02:00 UTC. '
  'Every other game week, counted from a boundary the game itself reported.';

-- The two moments a week's contribution has to be read at, given a period.
-- Derived rather than stored so nothing can hold a period whose measurement
-- points disagree with its own boundaries.
create function public.rank_period_week_ends(period_start timestamptz)
returns timestamptz[]
language sql
immutable
strict
set search_path = ''
as $$
  select array[
    period_start + interval '7 days' - interval '1 minute',
    period_start + interval '14 days' - interval '1 minute'
  ]
$$;

comment on function public.rank_period_week_ends(timestamptz) is
  '01:59Z on the last day of each of the period''s two weeks — the last '
  'minute before the game wipes the weekly boards.';
