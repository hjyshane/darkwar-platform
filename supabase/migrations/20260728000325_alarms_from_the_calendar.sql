-- 0325: entries from the game calendar.
--
-- Every five minutes a job reads the newest event calendar of each own
-- alliance's server (event_schedule_current, 0210) and files a `captured`
-- schedule entry on every board that watches an activity (0322). The board's
-- stage says which times of the calendar row the entry takes:
--
--   main    starts_at = the row's start, ends_at = battleEndTime or its end
--   signup  startSignUpTime -> stopSignUpTime         (Black Gold sign-up)
--   roster  stopSignUpTime  -> battleOpenTime         (Black Gold roster pick)
--
-- The entry's identity is 'cal:<activity>:<stage>:<calendar start epoch>', so
-- a reading that moves a time updates the entry in place and one that drops
-- the activity deletes nothing. An update touches ONLY starts_at, ends_at and
-- updated_at, and only when a time really differs (0327 posts a "moved"
-- notice off that change): never the title, the officer's message, the board
-- or `hidden`. Reminders are not made here; the entry trigger of 0322 does it.
--
-- Not a trigger, so one bad row never stops the run. A row missing a time it
-- needs, already past, or more than 14 days out is passed over silently — that
-- is the calendar's normal state, not an error. A row that raises (a time that
-- will not convert, a failed write) is skipped with a warning naming it, and
-- the rest of the run carries on.

create function internal.sync_calendar_alarms(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_n int;
  v_total int := 0;
begin
  for r in
    select cat.alliance_id, cat.category, cat.label, cat.kind, cat.activity_id,
           cat.activity_stage, c.starts_at as c_start, c.ends_at as c_end, c.detail
      from public.schedule_categories cat
      join public.alliances a
        on a.alliance_id = cat.alliance_id and a.is_own
      join public.event_schedule_current c
        on c.server_id = a.server_id and c.activity_id = cat.activity_id
     where cat.activity_id is not null
       and c.starts_at is not null
  loop
    begin
      if r.activity_stage = 'signup' then
        v_start := public.epoch_ms_to_timestamptz(r.detail -> 'startSignUpTime');
        v_end := public.epoch_ms_to_timestamptz(r.detail -> 'stopSignUpTime');
      elsif r.activity_stage = 'roster' then
        v_start := public.epoch_ms_to_timestamptz(r.detail -> 'stopSignUpTime');
        v_end := public.epoch_ms_to_timestamptz(r.detail -> 'battleOpenTime');
      else
        v_start := r.c_start;
        v_end := coalesce(public.epoch_ms_to_timestamptz(r.detail -> 'battleEndTime'), r.c_end);
      end if;

      if v_start is null or v_end is null
         or (case when r.kind = 'point' then v_start else v_end end) <= p_now
         or v_start > p_now + interval '14 days' then
        continue;
      end if;

      insert into public.schedule_events
        (alliance_id, title, category, starts_at, ends_at, source, source_key)
      values
        (r.alliance_id, r.label, r.category, v_start, v_end, 'captured',
         'cal:' || r.activity_id || ':' || r.activity_stage || ':'
           || floor(extract(epoch from r.c_start))::bigint)
      on conflict (alliance_id, source_key) where source_key is not null
      do update set starts_at = excluded.starts_at,
                    ends_at = excluded.ends_at,
                    updated_at = now()
       where (schedule_events.starts_at, schedule_events.ends_at)
             is distinct from (excluded.starts_at, excluded.ends_at);
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    exception when others then
      raise warning 'sync_calendar_alarms: skipped % % (%: %)',
        r.activity_id, r.activity_stage, sqlstate, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

revoke execute on function internal.sync_calendar_alarms(timestamptz) from public, anon, authenticated;

select cron.schedule(
  'alarms-calendar',
  '*/5 * * * *',
  $$ select internal.sync_calendar_alarms(); $$);
