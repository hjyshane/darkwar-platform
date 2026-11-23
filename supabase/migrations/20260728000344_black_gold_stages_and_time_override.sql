-- 0344: Black Gold's stages were read two days late, and an officer can now
-- change a game entry's times.
--
-- 1. The stages. 0325 filed "sign-up" as startSignUpTime -> stopSignUpTime and
--    "roster selection" as stopSignUpTime -> battleOpenTime. The alliance's
--    week is: Mon-Tue pick the battle TIME, Wed-Thu the ROSTER (ready), and
--    Sunday the A/B team battles. The calendar row says the same once read
--    right: startTime (Monday) -> startSignUpTime (Wednesday) is the time
--    selection, startSignUpTime -> stopSignUpTime (Wednesday to Friday) is the
--    roster selection, and the battles themselves are the alliance's own picks
--    (alliance_event_times, board game_black_gold), so they need no stage here.
--    The stage keys stay ('signup', 'roster') so existing entries and their
--    alarm settings are updated in place, not recreated.
--
-- 2. times_locked. The game's reading puts a captured entry's times back on
--    every run, so an edit would last five minutes. An officer's edit sets
--    times_locked and both writers (the calendar job and the alliance-pick
--    trigger) leave a locked entry's times alone. Clearing the flag hands the
--    entry back to the game, and the next reading restores its times.

alter table public.schedule_events
  add column times_locked boolean not null default false;

comment on column public.schedule_events.times_locked is
  'An officer set this entry''s times by hand. The calendar job (0325) and the '
  'alliance-pick trigger (0249/0326) skip a locked entry''s times; clearing the '
  'flag lets the game''s next reading put them back. Always false for manual entries.';

-- ------------------------------------------------------------ the calendar job

create or replace function internal.sync_calendar_alarms(p_now timestamptz default now())
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
        -- Time selection: from the week's start to the roster window.
        v_start := r.c_start;
        v_end := public.epoch_ms_to_timestamptz(r.detail -> 'startSignUpTime');
      elsif r.activity_stage = 'roster' then
        v_start := public.epoch_ms_to_timestamptz(r.detail -> 'startSignUpTime');
        v_end := public.epoch_ms_to_timestamptz(r.detail -> 'stopSignUpTime');
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
       where not schedule_events.times_locked
         and (schedule_events.starts_at, schedule_events.ends_at)
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

-- ------------------------------------------------- the alliance's own picks

create or replace function internal.apply_alliance_event_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text := 'game_' || new.event_key;
  v_key text;
  v_title text;
  v_label text;
begin
  if new.alliance_id is null or new.starts_at < now() - interval '14 days' then
    return new;
  end if;

  v_label := case new.event_key
    when 'zombie_siege' then 'Zombie Siege'
    when 'bio_mutant' then 'Frankie'
    else 'Black Gold'
  end;
  v_title := case new.event_key
    when 'zombie_siege' then 'Zombie Siege'
    when 'bio_mutant' then 'Frankie ' || new.slot
    else 'Black Gold, team ' || case new.slot when 1 then 'A' when 2 then 'B' else new.slot::text end
  end;
  v_key := new.event_key || ':' || new.slot || ':'
           || to_char((new.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD');

  if exists (
    select 1 from public.alliance_event_times t
     where t.alliance_id = new.alliance_id
       and t.event_key = new.event_key
       and t.slot = new.slot
       and t.snapshot_id <> new.snapshot_id
       and to_char((t.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD')
           = to_char((new.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD')
       and t.captured_at > new.captured_at
  ) then
    return new;
  end if;

  insert into public.schedule_categories (alliance_id, category, label, sort_order)
  values (new.alliance_id, v_category, v_label, 100)
  on conflict (alliance_id, category) do nothing;

  -- A moved pick moves the soonest future entry of that event and slot, keeping
  -- its id, message, steps and history. A locked entry is the officer's now.
  if not exists (
    select 1 from public.schedule_events e
     where e.alliance_id = new.alliance_id and e.source_key = v_key
  ) then
    update public.schedule_events e
       set source_key = v_key,
           starts_at = new.starts_at,
           ends_at = new.ends_at,
           updated_at = now()
     where e.schedule_event_id = (
       select o.schedule_event_id from public.schedule_events o
        where o.alliance_id = new.alliance_id
          and o.source = 'captured'
          and not o.times_locked
          and o.source_key like new.event_key || ':' || new.slot || ':%'
          and o.source_key <> v_key
          and o.starts_at > now()
        order by o.starts_at
        limit 1);
  end if;

  delete from public.schedule_events e
   where e.alliance_id = new.alliance_id
     and e.source = 'captured'
     and not e.times_locked
     and e.source_key like new.event_key || ':' || new.slot || ':%'
     and e.source_key <> v_key
     and e.starts_at > now();

  insert into public.schedule_events
    (alliance_id, title, body, category, starts_at, ends_at, source, source_key)
  values (
    new.alliance_id, v_title, null, v_category,
    new.starts_at, new.ends_at, 'captured', v_key)
  on conflict (alliance_id, source_key) where source_key is not null do update
    set starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        updated_at = now()
   where not schedule_events.times_locked;
  return new;
exception when others then
  raise warning 'apply_alliance_event_time: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

revoke all on function internal.apply_alliance_event_time() from public, anon, authenticated;

-- ------------------------------------------------------- names and seeding

create or replace function internal.seed_calendar_boards(p_alliance uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  insert into public.schedule_categories
    (alliance_id, category, label, sort_order, kind, start_reminders, activity_id, activity_stage)
  values
    (p_alliance, 'game_capital_clash', 'Capital Clash', 100, 'point', '{720,60,5}', '111001', 'main'),
    (p_alliance, 'game_black_gold_signup', 'Black Gold time selection', 100, 'window', '{}', '80002', 'signup'),
    (p_alliance, 'game_black_gold_roster', 'Black Gold roster selection', 100, 'window', '{}', '80002', 'roster')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function internal.seed_calendar_boards(uuid) from public, anon, authenticated;

-- Only a name nobody changed is renamed, on the board and on its entries.
update public.schedule_events e
   set title = 'Black Gold time selection'
 where e.source = 'captured' and e.title = 'Black Gold sign-up'
   and e.category = 'game_black_gold_signup';

update public.schedule_categories
   set label = 'Black Gold time selection'
 where category = 'game_black_gold_signup' and label = 'Black Gold sign-up';
