-- 0261: Discord says so when the database passes 7.5 GB.
--
-- 0258 records the database size on every daily retention pass and flags
-- `over_limit`, but nobody reads a log table until something is already wrong.
-- The disk allowance is 8 GB; this speaks at 7.5, with half a gigabyte of room
-- to act before the platform does it for us.
--
-- DATABASE-OWNED, like sync_stalled: composed and delivered inside Postgres
-- (deliver_owned_alerts), so `disk_high` joins internal.database_owned_events()
-- here AND DATABASE_OWNED in notify/worker.py, in the same change. Two
-- deliverers on one outbox row is two Discord messages.
--
-- WHEN IT RUNS. At the end of the daily retention pass, not on the minute tick:
-- the size moves over days, pg_database_size is not free, and the pass has just
-- decided what the size is. The idempotency key carries the UTC date, so it
-- speaks once a day for as long as the size stays over, and not at all while
-- it is under. Off is silent: no routing, no message, no size query.
--
-- PRIMARY ONLY. The disk is the platform's, not an alliance's, so this uses the
-- one-argument alert_channel (0131), as the collector-health alarms do.

create or replace function internal.database_owned_events()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['sync_stalled', 'player_claim', 'new_signup', 'schedule_reminder',
               'disk_high']::text[]
$$;

create function internal.detect_disk_high(
  p_limit_bytes bigint default (7.5 * 1024 ^ 3)::bigint
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text := internal.alert_channel('disk_high');
  v_bytes bigint;
  v_last record;
  v_written int := 0;
begin
  if v_channel is null then
    return 0;
  end if;

  v_bytes := pg_database_size(current_database());
  if v_bytes <= p_limit_bytes then
    return 0;
  end if;

  select r.ran_at, r.behind, r.deleted
    into v_last
  from internal.retention_runs r
  order by r.run_id desc
  limit 1;

  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  values (
    v_channel,
    'disk_high',
    'disk_high:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    'Database is nearly full',
    'The database is **' || pg_size_pretty(v_bytes) || '** against an 8 GB disk'
      || ' (alert line ' || pg_size_pretty(p_limit_bytes) || ').'
      || chr(10) || chr(10)
      || case
           when v_last.ran_at is null then 'The daily retention pass has not run yet.'
           when v_last.behind then 'The last retention pass ran out of batches '
             || 'before it ran out of work - it is behind.'
           else 'The last retention pass kept up, so what is left is data '
             || 'retention does not cover.'
         end
      || chr(10) || chr(10)
      || 'Look: `select * from internal.retention_runs order by ran_at desc limit 5`. '
      || 'Deleted rows only free disk after a VACUUM FULL '
      || '(docs/runbooks/retention.md).'
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function internal.detect_disk_high(bigint) is
  'Writes one outbox row per UTC day while pg_database_size exceeds the limit '
  '(default 7.5 GB) and the disk_high event is routed. Called at the end of '
  'internal.retention_daily; silent when switched off.';

revoke execute on function internal.detect_disk_high(bigint) from public, anon, authenticated;

-- 0258's body, plus the alert at the end. The log row is written first so the
-- message can say whether this very pass kept up.
create or replace function internal.retention_daily(p_max_batches int default 5)
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

  delete from internal.retention_runs where ran_at < now() - interval '180 days';

  perform internal.detect_disk_high();
  return v_run;
end;
$$;
