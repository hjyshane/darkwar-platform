-- 0004: operational tables and the Realtime publication.
-- adapter_registry is deferred with the event/season/report frameworks.

create table public.collectors (
  collector_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status public.collector_status not null default 'offline',
  version text,
  last_heartbeat_at timestamptz,
  last_packet_at timestamptz,
  last_sync_at timestamptz,
  outbox_depth int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger collectors_set_updated_at
  before update on public.collectors
  for each row execute function public.set_updated_at();

-- Snapshot provenance FKs, deferred from 0003 because collectors did not
-- exist yet. Sync must register the collector before writing snapshots.
alter table public.player_snapshots
  add constraint player_snapshots_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.player_detail_snapshots
  add constraint player_detail_snapshots_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.alliance_snapshots
  add constraint alliance_snapshots_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.alliance_member_snapshots
  add constraint alliance_member_snapshots_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.arena_matches
  add constraint arena_matches_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.arena_snapshots
  add constraint arena_snapshots_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);
alter table public.arena_entries
  add constraint arena_entries_collector_id_fkey
  foreign key (collector_id) references public.collectors (collector_id);

-- FR-COL-007: append-only health reports; current state is summarized on
-- collectors.
create table public.collector_heartbeats (
  heartbeat_id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (collector_id),
  status public.collector_status not null,
  version text,
  last_packet_at timestamptz,
  last_sync_at timestamptz,
  outbox_depth int,
  details jsonb not null default '{}'::jsonb,
  reported_at timestamptz not null default now()
);

create index collector_heartbeats_collector_reported_idx
  on public.collector_heartbeats (collector_id, reported_at desc);

-- Cloud→collector job queue. At this scale (8 servers, ≤100 players) a
-- table with FOR UPDATE SKIP LOCKED replaces PGMQ (deferred).
create table public.refresh_jobs (
  job_id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  priority int not null default 100,
  requested_by uuid references public.app_users (user_id),
  collector_id uuid references public.collectors (collector_id),
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger refresh_jobs_set_updated_at
  before update on public.refresh_jobs
  for each row execute function public.set_updated_at();

create index refresh_jobs_claim_idx
  on public.refresh_jobs (status, priority, next_attempt_at)
  where status in ('queued', 'failed');

-- Local execution results reported back by the collector (spec §10.2).
create table public.workflow_runs (
  run_id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (collector_id),
  refresh_job_id uuid references public.refresh_jobs (job_id),
  workflow text not null,
  status public.job_status not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index workflow_runs_collector_started_idx
  on public.workflow_runs (collector_id, started_at desc);
create index workflow_runs_job_idx
  on public.workflow_runs (refresh_job_id)
  where refresh_job_id is not null;

-- FR-COL-008 / FR-OPS-004: discovery inbox for unknown commands and fields.
-- sample must already be sanitized by the collector before sync.
create table public.schema_observations (
  schema_observation_id uuid primary key default gen_random_uuid(),
  collector_id uuid references public.collectors (collector_id),
  source_command text not null,
  fingerprint text not null,
  sample jsonb not null default '{}'::jsonb,
  seen_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  review_status text not null default 'new'
    check (review_status in ('new', 'reviewed', 'mapped', 'ignored')),
  unique (source_command, fingerprint)
);

-- NFR-010: actor, time, before/after for every privileged change.
create table public.audit_logs (
  audit_log_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users (user_id),
  actor_service public.app_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, occurred_at desc);

-- Lightweight realtime signal (FR-UI-005): the UI subscribes here and
-- refetches only the affected panel; it never subscribes to snapshot tables.
create table public.data_change_notifications (
  notification_id bigint generated always as identity primary key,
  topic text not null,
  server_id int references public.servers (server_id),
  entity_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index data_change_notifications_topic_idx
  on public.data_change_notifications (topic, created_at desc);

-- Pin the Realtime publication to exactly the notification tables (§10.4).
-- Recreating it (rather than altering) makes membership deterministic: the
-- default publication can otherwise silently include everything. pgTAP
-- asserts this membership. battle_report_delivery_jobs joins when that
-- pipeline is built.
drop publication if exists supabase_realtime;
create publication supabase_realtime for table
  public.data_change_notifications,
  public.refresh_jobs,
  public.collector_heartbeats;
