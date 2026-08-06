-- 0074: the alliance's daily contribution and daily duel totals.
--
-- The trends screen showed a mean activity SCORE, which is a percentile blend
-- and moves for reasons that are not the alliance doing more — a member joining
-- changes the pool and every percentile with it. What an officer wants on that
-- chart is the two figures the game itself reports: how much was donated today,
-- and how many duel points were scored today.
--
-- THREE THINGS THIS HAS TO GET RIGHT, and each of them is a way to be wrong by
-- a large factor rather than a little:
--
-- 1. THE GAME DAY STARTS AT 02:00 UTC, not midnight. Same boundary the week
--    rule uses (0001). A capture at 01:00 UTC belongs to the day before, and
--    bucketing by calendar date splits one game day across two rows and halves
--    both of them.
--
-- 2. THE DAILY BOARD ACCUMULATES, so a day's total is the LARGEST reading taken
--    that day, not the sum of the readings. On 2026-08-05 the daily battle board
--    was captured four times and read 43M, 46M, 52M, then 137M — the same points
--    counted again each time. Summing captures would report 279M for a day that
--    ended at 137M.
--
-- 3. THESE BOARDS CARRY OTHER ALLIANCES. `al.battle.rank.info` comes back with
--    189 rows for an alliance of 94, because the board is cross-alliance. A
--    total that did not restrict to our own people would be roughly double, and
--    would move when a stranger played.
--
-- DEFINER and member-gated, for `alliance_roster_history`'s reason: deciding who
-- is ours needs `alliance_member_snapshots`, which 0066 shut to officers, and an
-- invoker view would hand an ordinary member a total of one person. What escapes
-- is a sum and a count, per day, per kind. Nobody is named.
--
-- Membership is "ever in this alliance's roster" rather than "in it now". A
-- member who has since left still donated on the day they donated, and a total
-- that erased them would make the alliance look like it slowed down in the past.
create view public.alliance_daily_contribution as
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
where public.current_app_role() in ('member', 'officer', 'admin')
group by alliance_id, game_day, kind;

comment on view public.alliance_daily_contribution is
  'Per alliance, per game day (02:00 UTC), per contribution kind: the total '
  'across our own members. A day is the LARGEST reading taken that day, not '
  'the sum of readings, because the board accumulates. Restricted to game_uids '
  'that have appeared in this alliance''s roster, because these boards are '
  'cross-alliance.';

grant select on public.alliance_daily_contribution to authenticated;
