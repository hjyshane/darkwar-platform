-- 0001: extensions, shared functions, enums, and the internal schema.
-- Scope pinned by docs/bootstrap-plan.md; deferred domains (events, seasons,
-- battle reports, scoring result tables) are intentionally absent.

create extension if not exists pgcrypto;

-- Raw decoded payloads live outside the exposed schemas ("public",
-- "graphql_public" in config.toml), so PostgREST cannot serve them at all.
create schema if not exists internal;

revoke all on schema internal from public;
revoke all on schema internal from anon, authenticated;
grant usage on schema internal to service_role;
grant all on all tables in schema internal to service_role;
alter default privileges in schema internal grant all on tables to service_role;

-- Full decoded observation payloads, synced from the collector's SQLite
-- journal. Snapshot rows point here via observation_id, but without a FK:
-- raw payloads are retained ~90 days (spec §11.5) while snapshots are kept
-- long-term, so deletions here must not cascade or block.
create table internal.raw_observations (
  observation_id uuid primary key,
  collector_id uuid not null,
  source_command text not null,
  captured_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index raw_observations_command_captured_idx
  on internal.raw_observations (source_command, captured_at desc);

-- updated_at maintenance for mutable tables.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The game week resets Monday 02:00 UTC. This rule is implemented three
-- times (SQL, Python, TypeScript); all three consume the shared vectors in
-- protocol-fixtures/reset-week/vectors.json — change them together.
create function public.reset_week_start(ts timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = ''
as $$
  select (date_trunc('week', (ts at time zone 'UTC') - interval '2 hours')
          + interval '2 hours') at time zone 'UTC'
$$;

create type public.app_role as enum (
  'viewer',
  'member',
  'officer',
  'admin',
  'collector_service',
  'analyst_service'
);

-- FR-SEA-007 vocabulary; used by activity facts today.
create type public.measurement_type as enum (
  'observed',
  'calculated',
  'estimated'
);

-- Collector health states (spec §18.1).
create type public.collector_status as enum (
  'healthy',
  'degraded',
  'offline',
  'sync_backlog',
  'ui_blocked',
  'login_required',
  'parser_error'
);

create type public.job_status as enum (
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled'
);
