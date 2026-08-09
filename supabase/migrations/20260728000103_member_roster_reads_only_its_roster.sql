-- 0103: member_roster must read its own roster, not every roster ever captured.
--
-- 0102 shipped after being verified against twenty local rows, and production
-- said no within the hour: the members tab hit the statement timeout. The
-- tables it joins are not twenty rows — `alliance_member_snapshots` is 363,456
-- rows / 474 MB, `player_snapshots` 43,233 over 7,554 players — and the 0102
-- plan, reproduced locally at that scale, did three things the screen never
-- asked for:
--
--   1. Scanned ALL 362,860 member-snapshot index entries, because it reached
--      the roster through `alliance_roster_latest`, whose newest-batch CTE
--      computes max(captured_at) FOR EVERY ALLIANCE. The screen wants one.
--   2. Computed `player_power_growth` for all 7,554 players (full scan of
--      player_snapshots), because a JOIN's equality on the view's output
--      cannot be pushed under its per-player aggregation.
--   3. The same again for `player_growth_recent`.
--
-- 770 ms local with everything in RAM; production reads 316 MB cold on a
-- micro instance, which is how a number like that becomes a timeout. The old
-- eight-request page never had this problem because each request filtered at
-- the source: `player_id=in.(94 ids)` pushed into the growth views (0098
-- exists precisely to keep that shape indexed), and the roster query filtered
-- one alliance_id. 0102 collapsed the round trips and accidentally un-pushed
-- the filters. This migration keeps the one round trip and puts the filters
-- back:
--
--   - The own alliance's newest batch comes from a scalar max() under the
--     (alliance_id, captured_at) index — an index descent, not a group-by of
--     the world. `alliance_roster_latest` is no longer referenced.
--   - The growth views are joined LATERAL with `player_id =` inside, which is
--     exactly the filtered shape 59_growth_pushdown_test pins to the player
--     index. ~94 indexed probes instead of two full computations.
--   - contributions, presence, rank and subscriptions stay plain joins: their
--     sources are hundreds to a few thousand rows, and computing them whole
--     is cheaper than probing them per member.
--
-- Local, same 363k/43k seed, same member session: 770 ms -> 4 ms.
--
-- Verified against 0102's definition on the scale seed before replacing it:
-- identical rows out. Everything else — the DEFINER-with-InitPlan-gate
-- security model, the officer CASE-gate on subscription columns (0092), the
-- growth fallback with its timestamp (0069), the presence collapse — is
-- 0102's, unchanged. 62_member_roster_test still pins all of it.
--
-- The lesson is 59's, relearned the expensive way: a plan property is only
-- proven at a size where the planner has a real choice. Twenty rows prove
-- nothing; 62 now carries a scale fixture for exactly that reason.
create or replace view public.member_roster as
with own_batch as (
  -- One alliance, one timestamp: the newest capture of OUR roster. The scalar
  -- max() is an index descent under alliance_member_snapshots's
  -- (alliance_id, captured_at) index.
  select a.alliance_id,
         (select max(s.captured_at)
            from public.alliance_member_snapshots s
           where s.alliance_id = a.alliance_id) as captured_at
  from public.alliances a
  where a.is_own
  limit 1
),
roster as (
  select s.player_id, s.member_rank
  from public.alliance_member_snapshots s
  join own_batch b
    on s.alliance_id = b.alliance_id and s.captured_at = b.captured_at
  where s.player_id is not null
)
select
  r.player_id,
  p.current_name,
  p.hq_level,
  p.power,
  p.kills,
  p.last_seen_at,
  r.member_rank,
  c.daily_donation_score,
  c.weekly_donation_score,
  c.duel_daily_score,
  c.duel_weekly_score,
  c.duel_round_score,
  cr.assigned_rank,
  cr.computed_tier as computed_rank,
  cr.rank_score,
  coalesce(g.growth_1d, rec.growth_since_last) as growth_1d,
  g.growth_7d,
  coalesce(g.power_1d_at, rec.power_prev_at) as growth_1d_at,
  g.power_7d_at as growth_7d_at,
  pr.online_state,
  case
    when pr.online_state is null then null
    when pr.online_state = 'online' then pr.observed_at
    else pr.offline_since
  end as last_online_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then sub.month_card_expires_at end as month_card_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then sub.vip_level end as vip_level,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then sub.vip_expires_at end as vip_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then sub.svip_level end as svip_level
from roster r
join public.players p on p.player_id = r.player_id
left join public.player_contributions c on c.player_id = r.player_id
left join public.player_presence pr on pr.player_id = r.player_id
left join lateral (
  -- LIMIT 1 is load-bearing, not decoration: without it the planner is free
  -- to de-correlate the lateral back into a hash join and compute the view
  -- for all 7,500 players again — measured, it does exactly that. The limit
  -- makes the subquery unflattenable, so it runs once per roster row with
  -- player_id pushed inside, which is the indexed shape 59 pins. The views
  -- yield one row per player, so the limit changes nothing about the answer.
  select g0.growth_1d, g0.growth_7d, g0.power_1d_at, g0.power_7d_at
  from public.player_power_growth g0
  where g0.player_id = r.player_id
  limit 1
) g on true
left join lateral (
  select r0.growth_since_last, r0.power_prev_at
  from public.player_growth_recent r0
  where r0.player_id = r.player_id
  limit 1
) rec on true
left join public.player_current_rank cr on cr.player_id = r.player_id
left join public.player_subscriptions sub on sub.player_id = r.player_id
where (select public.current_app_role() = any (array['member','officer','admin']::public.app_role[]));

comment on view public.member_roster is
  'The members table in one query (0102), reading only what it answers about '
  '(0103): the own alliance''s newest batch via an index descent, and the '
  'growth views probed LATERAL per member so their per-player aggregation is '
  'never computed for the 7,500 players who are not on the roster. SECURITY '
  'DEFINER with an InitPlan role gate; subscription columns CASE-gated to '
  'officer and up (0092). 0102''s first shape read 363k roster rows and two '
  'full snapshot scans per visit and timed out on production.';
