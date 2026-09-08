-- A local stand-in for what Supabase provides before the first migration runs.
--
-- FOR A MACHINE WITH NO DOCKER. `supabase test db` needs the whole stack; this
-- needs PostgreSQL 16 and pgTAP and nothing else, and it is how the ten pgTAP
-- failures of 2026-09-08 were diagnosed after a month of nobody being able to
-- run the suite at all. See `run.sh` beside this file.
--
-- WHAT IT IS NOT. It is not the hosted schema and it is not the CLI's local
-- stack. It approximates the surface the migrations touch — auth, storage, the
-- API roles, and the default privileges — and where the approximation is wrong
-- the suite reports failures CI does not have. Those known gaps are listed in
-- run.sh. Treat a NEW failure here as real and a DISAGREEMENT with CI as this
-- file's fault until proven otherwise.
create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create extension if not exists pgtap with schema extensions;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin',
                           'supabase_auth_admin','supabase_storage_admin','authenticator']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text, email text,
  raw_user_meta_data jsonb, created_at timestamptz default now(),
  email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  encrypted_password text, confirmed_at timestamptz, updated_at timestamptz default now(),
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/') $$;

create function cron.schedule(job_name text, schedule text, command text)
  returns bigint language sql as $$ select 0::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;

-- What Supabase ships, and the thing 0065 only half-revoked. The exact set
-- matters: CI counts three surviving privileges on a view created after 0065,
-- which is INSERT/UPDATE/DELETE — i.e. the default grants the PostgREST four
-- rather than ALL.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
