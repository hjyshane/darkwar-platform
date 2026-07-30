-- 0009: per-member alliance contribution, the first confirmed source for the
-- Alliance Contribution activity domain (§12.1).
--
-- get.daily.alliance.donate.rank returns {uid, score, updateTime} per member —
-- a UID, not a display name, so attribution is real rather than inferred. Two
-- other candidates were rejected for exactly that reason:
-- al.battle.week.result.info gives a name only (names change, which is why
-- player_names exists) and get.alliance.boss.activity.info.new reports an
-- alliance total with no per-player identifier, so splitting it would be the
-- arbitrary distribution FR-SEA-008 forbids.
--
-- One table with a contribution_type discriminator rather than one table per
-- command: al.battle.rank.info was captured in the same session with the same
-- {uid, score} shape, so a second near-identical table would already be due.

create table public.alliance_contribution_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  -- The donation ranking names no alliance: it is implicitly the collector
  -- account's own. Left null rather than inferred from a same-day roster,
  -- which would be a guess dressed as a fact.
  alliance_id uuid references public.alliances (alliance_id),
  contribution_type text not null
    check (contribution_type in ('daily_donation', 'alliance_battle')),
  score bigint,
  rank int,
  -- When the score last changed, per the server. More precise than
  -- captured_at, which is only when we happened to look.
  score_updated_at timestamptz
);

create index alliance_contribution_snapshots_server_captured_idx
  on public.alliance_contribution_snapshots (server_id, captured_at desc);
create index alliance_contribution_snapshots_player_idx
  on public.alliance_contribution_snapshots (player_id, contribution_type, captured_at desc)
  where player_id is not null;

alter table public.alliance_contribution_snapshots enable row level security;

grant select on public.alliance_contribution_snapshots to anon, authenticated;
grant all on public.alliance_contribution_snapshots to service_role;

-- Alliance-internal, but every member sees this ranking in the game client,
-- so the line is drawn where the roster's is (§17.3 "제한 R" for Member).
create policy member_read on public.alliance_contribution_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger alliance_contribution_snapshots_notify
  after insert on public.alliance_contribution_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

insert into public.metric_registry (
  metric_key, display_name, domain, unit, entity_scope,
  aggregation, normalization_method, recommended_period, source_priority
) values (
  'alliance_donation_score', 'Alliance donation score', 'alliance_contribution',
  'points', 'player', 'max', 'percentile_rank', 'reset_week',
  '["get.daily.alliance.donate.rank"]'::jsonb
);
