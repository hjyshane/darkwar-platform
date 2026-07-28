-- 0005: metric_registry and activity_facts — the only two activity tables
-- fully specified today (§12.2, §12.3). Scoring result tables
-- (scoring_profiles, activity_scores, …) are deferred: their shape should
-- be decided after the first real scoring run; Appendix D's YAML is the
-- better v1 store until then.

create table public.metric_registry (
  metric_key text primary key,
  display_name text not null,
  domain text not null check (domain in (
    'presence',
    'growth',
    'alliance_contribution',
    'event_participation',
    'combat',
    'competition'
  )),
  unit text not null,
  entity_scope text not null check (entity_scope in (
    'player', 'alliance', 'team', 'building'
  )),
  aggregation text not null check (aggregation in (
    'sum', 'max', 'last', 'delta', 'count', 'distinct_days'
  )),
  normalization_method text,
  recommended_period text,
  source_priority jsonb not null default '[]'::jsonb,
  missing_data_policy text not null default 'exclude',
  outlier_policy jsonb not null default '{}'::jsonb,
  min_observation_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger metric_registry_set_updated_at
  before update on public.metric_registry
  for each row execute function public.set_updated_at();

-- Atomic measurement facts (§12.2 contract). Derived scores never replace
-- these. FR-ACT-004: an unobserved metric is a missing row, never a 0-value
-- row. event/season instance columns exist per the contract but gain FKs
-- only when those frameworks land.
create table public.activity_facts (
  fact_id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players (player_id),
  alliance_id uuid references public.alliances (alliance_id),
  occurred_at timestamptz not null,
  activity_type text not null,
  metric_key text not null references public.metric_registry (metric_key),
  value_numeric numeric not null,
  unit text not null,
  event_instance_id uuid,
  season_instance_id uuid,
  source_type text not null,
  -- FR-ACT-008 drill-down: fact → snapshot row → observation_id → raw
  -- payload. Polymorphic across snapshot tables, so no FK; source_type
  -- names the table.
  source_snapshot_id uuid,
  measurement_type public.measurement_type not null,
  confidence numeric not null default 1.0
    check (confidence >= 0 and confidence <= 1),
  schema_version int not null default 1,
  -- Same exactly-once discipline as snapshots: replaying the emitter must
  -- not duplicate facts.
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (player_id is not null or alliance_id is not null)
);

create index activity_facts_player_metric_idx
  on public.activity_facts (player_id, metric_key, occurred_at desc)
  where player_id is not null;
create index activity_facts_alliance_metric_idx
  on public.activity_facts (alliance_id, metric_key, occurred_at desc)
  where alliance_id is not null;

-- First metric (S11): arena participation observed from arena snapshots.
insert into public.metric_registry (
  metric_key, display_name, domain, unit, entity_scope,
  aggregation, normalization_method, recommended_period
) values (
  'arena_participation', 'Arena participation', 'competition', 'boolean',
  'player', 'max', 'binary_threshold', 'reset_week'
);
