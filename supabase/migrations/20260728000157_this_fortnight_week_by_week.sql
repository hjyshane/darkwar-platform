-- 0157: what each member has done in the fortnight now running, week by week.
--
-- The members table shows the rank and score of the last FINISHED fortnight,
-- and 0134 made that deliberate: a period still running has only one of its
-- two weekly readings, so scoring it mid-flight moves people's ranks for a
-- reason that is half missing. That decision stands.
--
-- What it leaves the alliance without is any view of the fortnight they are
-- actually living in. "Am I above the line this week" is a question asked on
-- Wednesday, not a fortnight later, and until now the only answer was the
-- previous period's.
--
-- So this is the running fortnight's RAW READINGS, not a score. No percentile,
-- no weights, no tier — the two numbers the game itself shows on its weekly
-- boards, split by week, for each member of the current roster. Nothing here
-- can move anybody's rank, which is what makes showing an unfinished period
-- safe.
--
-- WHY NOT READ rank_period_snapshots. That table only has rows for a period
-- somebody pressed Build on. A screen that shows the running fortnight cannot
-- depend on an officer having pressed a button this week, and building on
-- open would write half-finished scores into the history 0134 is protecting.
-- These figures come straight from the contribution snapshots instead.
--
-- Shape follows today's lessons: driven from `member_roster_current` (82 rows)
-- with one indexed probe per member per week per board — the newest reading
-- inside each week window, which is exactly what the scorer takes. Four probes
-- a member, all on `alliance_contribution_snapshots_uid_type_idx` (0110).

create or replace view public.member_current_period_contribution
with (security_invoker = true) as
with period as (
  select
    public.rank_period_start(now()) as period_start,
    (public.rank_period_week_ends(public.rank_period_start(now())))[1] as week1_end,
    (public.rank_period_week_ends(public.rank_period_start(now())))[2] as week2_end
)
select
  r.player_id,
  p.current_name,
  p.game_uid,
  d.period_start,
  d.week1_end,
  d.week2_end,
  w1d.score as donation_week1,
  w2d.score as donation_week2,
  w1x.score as duel_week1,
  w2x.score as duel_week2,
  -- The fortnight so far. Null on both sides stays null: a member with no
  -- reading has not donated nothing, they have not been read.
  case when w1d.score is null and w2d.score is null then null
       else coalesce(w1d.score, 0) + coalesce(w2d.score, 0) end as donation_total,
  case when w1x.score is null and w2x.score is null then null
       else coalesce(w1x.score, 0) + coalesce(w2x.score, 0) end as duel_total,
  greatest(w1d.captured_at, w2d.captured_at, w1x.captured_at, w2x.captured_at)
    as newest_reading_at
from public.member_roster_current r
join public.players p on p.player_id = r.player_id
cross join period d
-- The newest reading inside each window, the same figure build_rank_period
-- takes: these boards accumulate through the week and reset when the game
-- clears them, so the last reading of a week IS that week's total.
left join lateral (
  select s.score, s.captured_at
  from public.alliance_contribution_snapshots s
  where s.game_uid = p.game_uid
    and s.contribution_type = 'weekly_donation'
    and s.captured_at > d.period_start
    and s.captured_at <= d.week1_end
  order by s.captured_at desc
  limit 1
) w1d on true
left join lateral (
  select s.score, s.captured_at
  from public.alliance_contribution_snapshots s
  where s.game_uid = p.game_uid
    and s.contribution_type = 'weekly_donation'
    and s.captured_at > d.week1_end
    and s.captured_at <= d.week2_end
  order by s.captured_at desc
  limit 1
) w2d on true
left join lateral (
  select s.score, s.captured_at
  from public.alliance_contribution_snapshots s
  where s.game_uid = p.game_uid
    and s.contribution_type = 'alliance_battle_weekly'
    and s.captured_at > d.period_start
    and s.captured_at <= d.week1_end
  order by s.captured_at desc
  limit 1
) w1x on true
left join lateral (
  select s.score, s.captured_at
  from public.alliance_contribution_snapshots s
  where s.game_uid = p.game_uid
    and s.contribution_type = 'alliance_battle_weekly'
    and s.captured_at > d.week1_end
    and s.captured_at <= d.week2_end
  order by s.captured_at desc
  limit 1
) w2x on true;

comment on view public.member_current_period_contribution is
  'The RUNNING fortnight''s weekly donation and duel readings per current '
  'roster member, split by week. Raw readings, never a score or a tier: 0134 '
  'keeps the members table on the last finished period, and nothing here can '
  'move a rank. One indexed probe per member per week per board (0110).';

grant select on public.member_current_period_contribution to authenticated;
