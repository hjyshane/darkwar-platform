-- 0112: build_rank_period needs the whole roster, so members may not run it.
--
-- 0090 drew the line deliberately: computing touches nothing an admin owns,
-- so a plain member could run the computing half. That reasoning predates the
-- 0105 lesson (a SECURITY DEFINER function sheds no RLS on hosted Supabase),
-- and the two do not survive contact:
--
--   The computation reads every member's history out of
--   alliance_member_snapshots — first_seen and member_rank per player. The
--   0066 policy shows a member only their OWN rows there (officer/admin or
--   player_id = linked_player_id()). Under a member session the per-player
--   probes therefore come back empty for everyone else: the 0110 benchmark
--   watched a member-session probe filter out all 8,210 rows of one player's
--   history and return nothing.
--
--   Null first_seen and null member_rank are not neutral. first_seen null
--   defeats the newcomer check one way (never `unmeasured` by join date);
--   member_rank null defeats the officer check (never `unranked`); and the
--   roster minimum computed over one player's rows misplaces
--   roster_first_seen for the comparison that IS made. A member pressing
--   Rebuild would not get an error — they would get a period scored from a
--   roster of one and written over the real answer for every member.
--
-- No wrong data is known to exist: the Rebuild button lives behind the admin
-- settings gate, and the tier spread of the current production build (R1 17 /
-- R2 35 / R3 29 / 16 unmeasured, computed 2026-08-12 by an admin session) is
-- not the all-unmeasured shape a member run would leave.
--
-- So the guard moves to where the data boundary already is: officer and
-- admin, the two roles the 0066 policy hands the whole roster. If a rebuild
-- worker ever automates this (docs/runbooks/rank-report.md, trap 3), its
-- account needs the officer role, not member.
--
-- The body below is 0110's verbatim except the guard; the arithmetic is
-- pinned by tests 28/40/43/44 and must not move.
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
  -- Officer and up (0112). The computation reads the whole roster's history,
  -- and 0066 gives that read to officer/admin only — a member session would
  -- compute from its own rows and write wrong tiers for everybody else.
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
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
  -- de-correlates back to the whole-table aggregate 0110 removed.
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
  'Every per-member figure is an index probe (0110). Officer and up (0112): '
  'the computation needs every member''s snapshot history, 0066 gives that '
  'read to officer/admin only, and RLS holds inside SECURITY DEFINER on '
  'hosted Supabase (0105) — a member call would score the roster from their '
  'own rows alone and write wrong tiers for everyone else.';

-- The wrapper's contract statement changes with it: "the computing half needs
-- neither" was 0090's claim, and it is the claim 0112 retires.
comment on function public.rebuild_rank_period(timestamptz, boolean) is
  'Rebuilds a period, and optionally applies it: with p_apply_to_assigned, a '
  'computed R1-R3 replaces a hand-set R1-R3 by clearing the override, so the '
  'roster shows the new answer. Only ever on the strength of the row this '
  'rebuild wrote — a member it skipped keeps their rank rather than being '
  'judged by an older scoring version that still wears the same period. R4 and '
  'R5 are left alone; the clearing half needs members.manage and an explicit '
  'yes. The computing half needs officer or admin (0112) — a member session '
  'cannot see the roster history the computation reads.';
