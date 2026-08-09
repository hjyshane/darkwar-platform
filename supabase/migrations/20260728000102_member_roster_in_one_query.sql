-- 0102: the members table, answered in one round trip.
--
-- The members screen assembled its table from EIGHT requests: roster ids, the
-- player rows, then six per-player reads (contributions, presence, growth x2,
-- rank, subscriptions) that could not leave until the roster ids had come back.
-- Every query was already milliseconds — 0098/0099/0100 saw to that — but the
-- database is in us-east-2 and the readers are not, so each request costs
-- 101-189 ms before it does any work, and a CORS preflight doubles it on first
-- visit. Three sequential stages of that is the 3-4 seconds the screen took.
-- The waterfall was the whole bill, so the fix is to stop asking in stages:
-- one view, one request, one round trip.
--
-- SECURITY DEFINER WITH ONE GATE, the 0067 pattern (`alliance_roster_latest`),
-- not security_invoker. Invoker would be the reflex — 0097 exists because a
-- view forgot it — but here it would put an RLS qual under every one of the
-- seven relations this view joins, and 0100 just spent a day on what those
-- quals cost: `current_app_role()` cannot be inlined or estimated, so it runs
-- per row per scan and drags every estimate to 1. Reading as owner, the
-- planner sees clean statistics and the role check runs a handful of times per
-- query instead of thousands. The gates make that safe:
--
--   - membership gate, in WHERE: members and up, or nothing. Written as a
--     scalar subquery on purpose — that makes it an InitPlan, evaluated once
--     per query, not once per row.
--   - officer gate, per subscription column: what people pay for is
--     officer-only (0092), and a member-gated definer view that leaked
--     `vip_level` to members would silently undo that decision. The columns
--     are CASE-wrapped so a member gets the roster with those cells null —
--     the same shape the screen already renders for "not yours to see".
--
-- 58_relation_reach_test's assertion 4 recognises the gate by name; this view
-- joins sync_status's club of deliberate definers by carrying its own check.
--
-- Roster membership comes from `alliance_roster_latest` filtered to the own
-- alliance — 0067's answer to "who is in the alliance NOW", not
-- `players.current_alliance_id`, which is "last known alliance" and never
-- cleared (three screens got that wrong before 0067). The old frontend kept a
-- fallback to the stale players list for when the roster view had no batches;
-- that was a young-database concern, the roster has had daily batches since
-- 08-04, and a fallback reimplemented in SQL would keep alive the exact bug
-- 0067 exists to end. No batches now honestly means an empty table.
--
-- The growth coalesce moved here from the frontend, unchanged in meaning: the
-- fixed 1-day baseline when it exists (0055), otherwise since-the-previous-
-- reading (0069), and the timestamp travels WITH the figure it belongs to.
-- The pair cannot split — power_1d_at is null exactly when growth_1d is.
--
-- Presence collapses to one sortable instant, same rule as the frontend had:
-- for someone online the last moment we know they were there is the
-- observation that said so; for someone offline it is when they went.
create view public.member_roster as
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
from public.alliance_roster_latest r
join public.alliances a on a.alliance_id = r.alliance_id and a.is_own
join public.players p on p.player_id = r.player_id
left join public.player_contributions c on c.player_id = r.player_id
left join public.player_presence pr on pr.player_id = r.player_id
left join public.player_power_growth g on g.player_id = r.player_id
left join public.player_growth_recent rec on rec.player_id = r.player_id
left join public.player_current_rank cr on cr.player_id = r.player_id
left join public.player_subscriptions sub on sub.player_id = r.player_id
where r.player_id is not null
  and (select public.current_app_role() = any (array['member','officer','admin']::public.app_role[]));

comment on view public.member_roster is
  'The members table in one query: roster membership (0067''s answer, not the '
  'never-cleared players.current_alliance_id) joined to contributions, presence, '
  'growth with its 0069 fallback, rank and subscriptions. SECURITY DEFINER with '
  'an InitPlan role gate instead of invoker, because seven RLS quals of '
  'current_app_role() per row is the disease 0100 documented. Subscription '
  'columns are CASE-gated to officer and up (0092); members get them as null. '
  'Exists to collapse the members screen''s three request waves into one round '
  'trip — the queries were milliseconds, the ocean crossings were not.';

grant select on public.member_roster to authenticated;
