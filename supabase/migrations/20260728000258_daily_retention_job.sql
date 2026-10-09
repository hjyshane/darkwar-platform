-- 0258: retention runs every day by itself, and records what it did.
--
-- 0256 made the purge runnable in batches; this makes it routine. Run daily,
-- each pass only has about a day of newly-expired rows to remove, so it is
-- cheap, and the table files stop growing: autovacuum hands the freed pages to
-- new inserts. (DELETE alone never lowers pg_database_size; the one-time
-- VACUUM FULL in docs/runbooks/retention.md does that, once.)
--
-- WHY A SCHEDULE AND NOT A "OVER 7.5 GB" TRIGGER. After a purge the size still
-- reads high until a rewrite, so a size trigger would fire on every run
-- forever. The size is RECORDED instead, per run, so a climb is visible
-- without the job depending on it.
--
-- BOUNDED. One function call is one transaction, so a run stops after
-- p_max_batches rounds (default 5 x 20,000 rows per table) and reports
-- `behind = true` if the last round still found work. The next day continues.
--
-- NOT DONE HERE: a Discord alert for "over 7.5 GB". Alert events are listed on
-- both sides (internal.database_owned_events and DATABASE_OWNED in
-- notify/worker.py, pinned by test 76) and routed in app_settings; that is its
-- own change. Until then: select * from internal.retention_runs order by ran_at desc.

create table internal.retention_runs (
  run_id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  db_bytes bigint not null,
  batches int not null,
  deleted jsonb not null default '{}'::jsonb,
  behind boolean not null,
  over_limit boolean generated always as (db_bytes > 7.5 * 1024 ^ 3) stored
);

alter table internal.retention_runs enable row level security;
revoke all on internal.retention_runs from public, anon, authenticated;
grant select on internal.retention_runs to service_role;

comment on table internal.retention_runs is
  'One row per daily retention pass: database size, rows removed per table, '
  'and whether the pass ran out of batches before running out of work. '
  'over_limit = size above 7.5 GB (the disk allowance is 8 GB).';

create function internal.retention_daily(p_max_batches int default 5)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted jsonb := '{}'::jsonb;
  v_batches int := 0;
  v_behind boolean := false;
  v_found boolean;
  v_run bigint;
  r record;
begin
  while v_batches < p_max_batches loop
    v_found := false;
    for r in select * from public.retention_purge(true) loop
      v_found := true;
      v_deleted := jsonb_set(
        v_deleted, array[r.relation],
        to_jsonb(coalesce((v_deleted ->> r.relation)::bigint, 0) + r.rows));
    end loop;
    exit when not v_found;
    v_batches := v_batches + 1;
    v_behind := v_batches = p_max_batches;
  end loop;

  insert into internal.retention_runs (db_bytes, batches, deleted, behind)
  values (pg_database_size(current_database()), v_batches, v_deleted, v_behind)
  returning run_id into v_run;

  -- The log is for looking at, not for keeping.
  delete from internal.retention_runs where ran_at < now() - interval '180 days';
  return v_run;
end;
$$;

comment on function internal.retention_daily(int) is
  'Daily pass of retention_purge(true), at most p_max_batches rounds, logged to '
  'internal.retention_runs. behind = the last allowed round still removed rows.';

revoke execute on function internal.retention_daily(int) from public, anon, authenticated;

select cron.schedule(
  'retention-daily',
  '23 4 * * *',
  $$ select internal.retention_daily(); $$);
