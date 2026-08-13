-- 0110: build_rank_period reads per-member probes, not full-table scans.
--
-- WHAT BROKE. The dashboard's Rebuild button died of statement timeout on
-- 2026-08-12: rebuild_rank_period('2026-08-03') measured 11.9s under an
-- authenticated session against the 8s default, with 3,189,084 buffer hits
-- for a 97-member fortnight. The 08-08 build of the same period had passed —
-- four days of growth pushed it over the line, and the period's CLOSING
-- rebuild on 08-17 would have hit a still larger table.
--
-- WHERE THE BUFFERS WENT. Two shapes, both of the class 0100/0105 documented
-- (a SECURITY DEFINER function sheds no RLS on hosted Supabase, so every row
-- a scan touches pays a current_app_role() qual):
--
--   1. Three whole-history scans of alliance_member_snapshots (821,576 rows
--      in production): roster_start (min over the alliance), seen (min per
--      player), ranks_at_end (DISTINCT ON per player). Each visits every row
--      the alliance ever produced to answer a per-member question whose
--      answer sits at one end of an index that already exists.
--   2. The contribution probe filters on game_uid, but the only index leads
--      with player_id — so each of the ~388 LATERAL probes (97 members × 2
--      weeks × 2 kinds) walked alliance_contribution_snapshots (104,030
--      rows) start to finish.
--
-- THE FIX is the 0103 prescription applied to its third and fourth homes:
-- every per-member figure becomes a LATERAL probe that descends an index and
-- stops — `limit 1` (or a min() the planner turns into one) carries the
-- load. presence loses its DISTINCT ON entirely: player_presence has been
-- one row per player (primary key) since 0024, so the sort was ordering a
-- table that cannot contain a duplicate.
--
-- The rules are unchanged — same weights, same pool, same tiers, same
-- reasons. Tests 40/43/44 pin the answers; this migration must not move
-- them.

-- The probe shape of `reading`, verbatim: equality on game_uid and
-- contribution_type, newest captured_at first.
create index alliance_contribution_snapshots_uid_type_captured_idx
  on public.alliance_contribution_snapshots (game_uid, contribution_type, captured_at desc);

create or replace function public.build_rank_period(p_period_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written integer;
  week_ends timestamptz[] := public.rank_period_week_ends(p_period_start);
  period_end timestamptz := p_period_start + interval '14 days';
  -- Never later than now. period_end is in the future for every period still
  -- running, and absence measured to it is mostly the part of the fortnight
  -- that has not happened (0075).
  measured_to timestamptz := least(p_period_start + interval '14 days', now());
  settings jsonb;
  w_donation numeric;
  w_duel numeric;
  w_growth numeric;
  w_total numeric;
  offline_cut numeric;
  r3 numeric;
  r2 numeric;
begin
  if public.current_app_role() not in ('member', 'officer', 'admin') then
    raise exception 'members only' using errcode = '42501';
  end if;

  select value into settings from public.app_settings where key = 'rank_tiers';
  w_donation := coalesce((settings -> 'weights' ->> 'donation')::numeric, 0);
  w_duel := coalesce((settings -> 'weights' ->> 'duel')::numeric, 0);
  w_growth := coalesce((settings -> 'weights' ->> 'power_growth')::numeric, 0);
  w_total := nullif(w_donation + w_duel + w_growth, 0);
  offline_cut := coalesce((settings ->> 'offline_hours')::numeric, 48);
  r3 := coalesce((settings ->> 'r3_percent')::numeric, 20);
  r2 := coalesce((settings ->> 'r2_percent')::numeric, 50);

  with own_alliance as (
    select a.alliance_id from public.alliances a where a.is_own limit 1
  ),
  -- min() rather than order-by-limit-1 so an empty table still yields one row
  -- (null) — `members` cross-joins this, and zero rows here would erase the
  -- roster. The planner turns the aggregate into an index descent on
  -- (alliance_id, captured_at) by itself.
  roster_start as (
    select min(s.captured_at) as roster_first_seen
    from public.alliance_member_snapshots s
    where s.alliance_id = (select alliance_id from own_alliance)
  ),
  -- Per-member probes replace the whole-history scans. LEFT JOIN LATERAL ON
  -- TRUE keeps a member with no matching row, exactly as the old left joins
  -- against the aggregate CTEs did.
  members as (
    select p.player_id, p.game_uid, p.current_name,
      mr.member_rank, sn.first_seen, rs.roster_first_seen
    from public.players p
    join public.alliances a on a.alliance_id = p.current_alliance_id
    cross join roster_start rs
    left join lateral (
      select min(s.captured_at) as first_seen
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id and s.alliance_id = a.alliance_id
    ) sn on true
    left join lateral (
      select s.member_rank
      from public.alliance_member_snapshots s
      where s.player_id = p.player_id
        and s.alliance_id = a.alliance_id
        and s.captured_at <= period_end
      order by s.captured_at desc
      limit 1
    ) mr on true
    where a.is_own
  ),
  reading as (
    select m.player_id, w.idx, t.kind, c.score, c.captured_at
    from members m
    cross join lateral (values
      (1, p_period_start, week_ends[1]),
      (2, week_ends[1], week_ends[2])
    ) as w(idx, opens, closes)
    cross join lateral (values ('weekly_donation'), ('alliance_battle_weekly')) as t(kind)
    cross join lateral (
      select s.score, s.captured_at
      from public.alliance_contribution_snapshots s
      where s.game_uid = m.game_uid
        and s.contribution_type = t.kind
        and s.captured_at > w.opens
        and s.captured_at <= w.closes
      order by s.captured_at desc
      limit 1
    ) c
  ),
  contribution as (
    select
      player_id,
      max(score) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 1) as donation_week1_at,
      max(score) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2,
      max(captured_at) filter (where kind = 'weekly_donation' and idx = 2) as donation_week2_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 1) as duel_week1_at,
      max(score) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2,
      max(captured_at) filter (where kind = 'alliance_battle_weekly' and idx = 2) as duel_week2_at
    from reading
    group by player_id
  ),
  -- The 0103 shape: the newest row at each boundary is one index descent per
  -- member, and the limit is what carries the load — without it the planner
  -- de-correlates back to the whole-table aggregate this migration removes.
  figures as (
    select
      m.player_id, m.game_uid, m.current_name,
      m.member_rank, m.first_seen, m.roster_first_seen,
      c.donation_week1, c.donation_week1_at, c.donation_week2, c.donation_week2_at,
      c.duel_week1, c.duel_week1_at, c.duel_week2, c.duel_week2_at,
      case when c.donation_week1 is null and c.donation_week2 is null then null
           else coalesce(c.donation_week1, 0) + coalesce(c.donation_week2, 0) end
        as donation_total,
      case when c.duel_week1 is null and c.duel_week2 is null then null
           else coalesce(c.duel_week1, 0) + coalesce(c.duel_week2, 0) end
        as duel_total,
      ps.power as power_start, ps.captured_at as power_start_at,
      pe.power as power_end, pe.captured_at as power_end_at,
      case when ps.power is null or ps.power = 0 or pe.power is null then null
           else (pe.power - ps.power)::numeric / ps.power * 100 end as power_growth,
      case
        when pr.player_id is null then null
        when pr.online_state = 'offline' and pr.offline_since is not null
          then greatest(extract(epoch from measured_to - pr.offline_since) / 3600, 0)
        else 0
      end as offline_hours
    from members m
    left join contribution c using (player_id)
    left join lateral (
      select s.power, s.captured_at
      from public.player_snapshots s
      where s.player_id = m.player_id
        and s.power is not null
        and s.captured_at <= p_period_start
      order by s.captured_at desc
      limit 1
    ) ps on true
    left join lateral (
      select s.power, s.captured_at
      from public.player_snapshots s
      where s.player_id = m.player_id
        and s.power is not null
        and s.captured_at <= period_end
        and s.captured_at > p_period_start
      order by s.captured_at desc
      limit 1
    ) pe on true
    -- One row per player by primary key since 0024; the old DISTINCT ON was
    -- ordering a table that cannot hold a duplicate. The observed_at bound
    -- is kept: a reading from after the measurement window must not count.
    left join public.player_presence pr
      on pr.player_id = m.player_id and pr.observed_at <= measured_to
  ),
  classified as (
    select *,
      -- Officers are measured but not ranked; a witnessed newcomer is neither.
      (member_rank is not null and member_rank >= 4) as unranked,
      (first_seen is not null
        and first_seen > p_period_start - interval '14 days'
        and first_seen > roster_first_seen) as unmeasured
    from figures
  ),
  pool as (
    -- Whose numbers define the percentiles. Nobody else is in this ordering.
    select * from classified where not unranked and not unmeasured
  ),
  ranked as (
    select c.*,
      -- Inside the pool: percent_rank, as before. Outside it and still
      -- measured: the fraction of the pool this figure beats — the same
      -- question, asked from outside, so an officer gets a real number without
      -- moving anybody else's.
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.donation_total < c.donation_total)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.donation_total < c.donation_total)
                  / nullif(count(*), 0)
           from pool p)
      end as donation_pct,
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.duel_total < c.duel_total)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.duel_total < c.duel_total)
                  / nullif(count(*), 0)
           from pool p)
      end as duel_pct,
      case
        when c.unmeasured then null
        when not c.unranked then
          (select 100.0 * count(*) filter (where p.power_growth < c.power_growth)
                  / nullif(count(*) - 1, 0)
           from pool p)
        else
          (select 100.0 * count(*) filter (where p.power_growth < c.power_growth)
                  / nullif(count(*), 0)
           from pool p)
      end as growth_pct
    from classified c
  ),
  scored as (
    select *,
      case
        when unmeasured then null
        when w_total is null then null
        when donation_total is null and duel_total is null and power_growth is null then null
        else (w_donation * coalesce(donation_pct, 0)
              + w_duel * coalesce(duel_pct, 0)
              + w_growth * coalesce(growth_pct, 0)) / w_total
      end as activity_score
    from ranked
  ),
  placed as (
    select s.*,
      -- The tier cut is decided by the pool alone. An officer's score does not
      -- move the R3/R2 boundary, which is the whole reason they are unranked.
      case when s.unranked or s.unmeasured then null
      else
        (select 100.0 * count(*) filter (where p2.activity_score > s.activity_score)
                / nullif(count(*), 0)
         from scored p2 where not p2.unranked and not p2.unmeasured)
      end as place
    from scored s
  )
  insert into public.rank_period_snapshots (
    period_start, player_id, game_uid, name, scoring_version,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours, tier, tier_reason)
  select
    p_period_start, player_id, game_uid, current_name, 4,
    donation_week1, donation_week1_at, donation_week2, donation_week2_at,
    duel_week1, duel_week1_at, duel_week2, duel_week2_at,
    donation_total, duel_total,
    power_start, power_start_at, power_end, power_end_at, power_growth,
    donation_pct, duel_pct, growth_pct, activity_score,
    offline_hours,
    case
      when unmeasured then null
      when unranked then null
      when offline_hours is not null and offline_hours >= offline_cut then 'R1'
      when activity_score is null then null
      when place < r3 then 'R3'
      when place < r3 + r2 then 'R2'
      else 'R1'
    end,
    case
      when unmeasured then 'not measured: joined within the last two weeks'
      when unranked then 'measured but not ranked: R4 and above'
      when offline_hours is not null and offline_hours >= offline_cut then 'offline'
      when activity_score is null then 'nothing was captured for this member in this period'
      else 'score'
    end
  from placed
  on conflict (period_start, player_id, scoring_version) do update set
    game_uid = excluded.game_uid, name = excluded.name,
    donation_week1 = excluded.donation_week1, donation_week1_at = excluded.donation_week1_at,
    donation_week2 = excluded.donation_week2, donation_week2_at = excluded.donation_week2_at,
    duel_week1 = excluded.duel_week1, duel_week1_at = excluded.duel_week1_at,
    duel_week2 = excluded.duel_week2, duel_week2_at = excluded.duel_week2_at,
    donation_total = excluded.donation_total, duel_total = excluded.duel_total,
    power_start = excluded.power_start, power_start_at = excluded.power_start_at,
    power_end = excluded.power_end, power_end_at = excluded.power_end_at,
    power_growth = excluded.power_growth,
    donation_pct = excluded.donation_pct, duel_pct = excluded.duel_pct,
    growth_pct = excluded.growth_pct, activity_score = excluded.activity_score,
    offline_hours = excluded.offline_hours, tier = excluded.tier,
    tier_reason = excluded.tier_reason, computed_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.build_rank_period(timestamptz) is
  'Scores one fortnight for the own alliance and writes rank_period_snapshots. '
  'Every per-member figure is an index probe (0110): the same answers as the '
  'whole-history scans it replaced, at a cost that does not grow with the '
  'tables'' full history — the Rebuild button was dying of statement timeout '
  'once alliance_member_snapshots passed 800k rows.';
