-- 0105: subscriptions by primary key, and a corrected premise.
--
-- The production EXPLAIN (dashboard SQL editor, officer session, 2026-08-09)
-- finally showed why member_roster timed out on production while answering in
-- 14 ms against a production-scale local seed, and the answer corrects the
-- premise 0102-0104 were written on:
--
--   ON HOSTED SUPABASE, A DEFINER VIEW DOES NOT SHED RLS. The local stack's
--   `postgres` is a superuser, so locally the owner read bypasses every
--   policy — that is why local measurements were clean. The hosted `postgres`
--   is not, and the production plan carries
--   `Filter: current_app_role() = ANY (...)` under every table the view
--   touches. The InitPlan gates still work as designed; the RLS quals
--   underneath simply never went away.
--
-- With the quals in place, their default selectivity collapsed the row
-- estimates to 1 again, and the planner put the `player_subscriptions` FULL
-- JOIN on the inner side of a nested loop WITHOUT a Materialize node — it
-- expected one loop and got 92. Each loop seq-scanned all 3,291
-- `player_month_cards` rows with the role check per row:
--
--   92 loops x 3,291 rows x ~0.04 ms/current_app_role() call  ~=  12.1 s
--
-- of the 13.5 s total. "Rows Removed by Join Filter: 312,248" is that loop
-- counted from the outside. Everything else held: the roster batch resolves
-- in a millisecond (0103's index descent), the growth laterals probe per
-- member (~625 ms), the rank join computes once (~150 ms).
--
-- A LATERAL over the subscriptions view would not help: its player_id is
-- COALESCE(mc.player_id, v.player_id) across a FULL JOIN, and a filter on a
-- COALESCE of both sides cannot be pushed into either. But the view exists
-- only to stitch two tables that are both KEYED BY player_id — so this
-- migration reads them directly. Two primary-key joins, worst case one small
-- scan each instead of ninety-two.
--
-- The officer CASE-gates stay on the columns, and on production RLS
-- (officer_read, 0092) now actually reaches this view's reads — for a member
-- the probes return no rows and the CASE returns null on top. Belt and
-- braces, one of which was believed to be the other until tonight.
create or replace view public.member_roster as
with own_batch as (
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
       then mc.expires_at end as month_card_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.vip_level end as vip_level,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.vip_expires_at end as vip_expires_at,
  case when (select public.current_app_role() = any (array['officer','admin']::public.app_role[]))
       then v.svip_level end as svip_level
from roster r
join public.players p on p.player_id = r.player_id
left join public.player_contributions c on c.player_id = r.player_id
left join public.player_presence pr on pr.player_id = r.player_id
left join lateral (
  -- LIMIT 1 is load-bearing (0103): it stops the planner de-correlating the
  -- lateral back into a full computation of the view for every player.
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
left join public.player_month_cards mc on mc.player_id = r.player_id
left join public.player_vip v on v.player_id = r.player_id
where (select public.current_app_role() = any (array['member','officer','admin']::public.app_role[]));

comment on view public.member_roster is
  'The members table in one query. Roster from the own alliance''s newest batch '
  '(index descent, 0103), growth probed LATERAL per member (0103), and '
  'subscriptions read straight from player_month_cards/player_vip by primary '
  'key (0105) — their stitching view''s FULL JOIN defeated filter pushdown and '
  'was recomputed 92 times per visit on production, 12 of the 13.5 timeout '
  'seconds. NOTE for future readers: on hosted Supabase this definer view does '
  'NOT bypass RLS (local superuser postgres does, which is why local numbers '
  'flatter it). Subscription columns CASE-gate to officer and up (0092), with '
  'officer_read RLS underneath as the second belt.';
