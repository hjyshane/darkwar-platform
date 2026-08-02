-- 0052: what each member did over a two-week period, and the rank it earns.
--
-- The figures come from observations bounded by the period, never from
-- "the values right now". At 02:00 on the day a period ends the game has
-- just wiped the weekly boards, so anything read after that scores the whole
-- alliance at zero. 0050 fixed the reading times at 01:59 on the last day of
-- each week; this reads whatever the collector actually captured at or
-- before each of them, and records which capture it used.
--
-- WEIGHTS APPLY TO PERCENTILES, NOT TO THE RAW FIGURES, and that is the
-- important decision in this file. The weights already in use read 0.4
-- donation / 0.6 duel, which looks like a mix and is not one: the alliance
-- averages 48,684 weekly donation against 3,502,889 duel points, so those
-- weights contribute 19,474 and 2,101,733 — the duel figure is 108x the
-- other and the donation may as well not be there. Ranking each figure
-- within the alliance first, then weighting the ranks, is what makes 0.4
-- and 0.6 mean what they look like.
create table public.rank_period_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  player_id uuid not null references public.players (player_id) on delete cascade,
  game_uid bigint not null,
  name text,

  -- Two readings per figure, kept apart from their sum. A total that came
  -- from one capture and a missed one is a different fact from a total that
  -- came from both, and only the parts can say which.
  donation_week1 bigint,
  donation_week1_at timestamptz,
  donation_week2 bigint,
  donation_week2_at timestamptz,
  duel_week1 bigint,
  duel_week1_at timestamptz,
  duel_week2 bigint,
  duel_week2_at timestamptz,
  donation_total bigint,
  duel_total bigint,

  power_start bigint,
  power_start_at timestamptz,
  power_end bigint,
  power_end_at timestamptz,
  power_growth numeric,

  -- Each figure's standing in the alliance, 0-100, and the weighted blend.
  donation_pct numeric,
  duel_pct numeric,
  growth_pct numeric,
  activity_score numeric,

  offline_hours numeric,
  tier text check (tier in ('R1', 'R2', 'R3')),
  -- 'score' or 'offline'. A member sent to R1 by the offline rule looks
  -- identical to one who simply scored badly, and the difference is the
  -- whole reason to look at the report.
  tier_reason text,

  computed_at timestamptz not null default now(),
  unique (period_start, player_id)
);

comment on table public.rank_period_snapshots is
  'One row per member per two-week period: what they contributed, how their '
  'power moved, and the rank that earns. Recomputed rather than frozen, so a '
  'capture that syncs late improves the answer instead of being locked out.';

create index rank_period_snapshots_period_idx
  on public.rank_period_snapshots (period_start desc, activity_score desc nulls last);

alter table public.rank_period_snapshots enable row level security;
grant select on public.rank_period_snapshots to authenticated;
grant all on public.rank_period_snapshots to service_role;

-- Alliance business, same gate as the roster it is derived from.
create policy member_read on public.rank_period_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- Tier settings live in app_settings so they inherit the settings.write
-- capability rather than inventing a second way to be allowed to change
-- something. Shares of the roster, not absolute scores: an absolute cut
-- cannot be chosen before there is history, and it goes stale as everyone's
-- numbers climb. The in-game ranks are limited slots anyway, which is what
-- a share is.
insert into public.app_settings (key, value) values (
  'rank_tiers',
  '{"r3_percent": 20, "r2_percent": 50, "offline_hours": 48,
    "weights": {"donation": 0.4, "duel": 0.6, "power_growth": 0}}'::jsonb
) on conflict (key) do nothing;
