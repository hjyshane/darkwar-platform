-- 0240: events can be added and edited from settings, and an event day declared
-- from the recorder.
--
-- Until now an event was a migration: attendance_event_kinds says in its own
-- header that a kind is "still written by migration", and every held day
-- (attendance_event_days) was seeded the same way. Asked for on 2026-10-07: add
-- a season event or a game event in settings and have it appear in
-- participation to be ticked.
--
-- What this adds, and what it leaves alone:
--   * `archived` on the kinds: hidden from the report and the recorder, rows
--     and history kept. Nothing is ever deleted, because event_attendance
--     references the kind and a deleted event would take its attendance with it.
--   * save_event_kind: add or edit an event's label, tab (event / season) and
--     order. NEVER touches `captured`: that flag means "the collector writes
--     this event", which only a collector change can make true, so a form
--     must not be able to claim it.
--   * declare_event_day: say an event was held on a day (or take it back), for
--     the alliance on screen. Without a declared day an event only counts as
--     held on days somebody ticked, so a new event would read 0 held until
--     the first tick.
--
-- Events are shared by every alliance, like the hero and pet catalogues: they
-- are facts about the game, so adding one needs catalogue.write. Held days are
-- per alliance and need data.enter, the capability that ticks attendance.

alter table public.attendance_event_kinds
  add column archived boolean not null default false;

comment on column public.attendance_event_kinds.archived is
  'Hidden from the participation report and the recorder (0240). The row and '
  'every attendance recorded against it stay.';

-- ---------------------------------------------------------------------------
-- Add or edit an event.

create function public.save_event_kind(
  p_kind text,
  p_label text,
  p_board text,
  p_sort_order int default null,
  p_archived boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
begin
  if not public.has_permission('catalogue.write') then
    raise exception 'editing events requires the catalogue.write permission'
      using errcode = '42501';
  end if;
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'an event key is lowercase letters, digits and underscores, 2 to 40 long'
      using errcode = '22023';
  end if;
  if length(v_label) not between 1 and 40 then
    raise exception 'an event name is 1 to 40 characters' using errcode = '22023';
  end if;
  if p_board is null or p_board not in ('event', 'season') then
    raise exception 'an event sits on the event or the season tab' using errcode = '22023';
  end if;

  insert into public.attendance_event_kinds (kind, label, board, sort_order, archived)
  values (
    p_kind, v_label, p_board,
    coalesce(p_sort_order,
             (select coalesce(max(k.sort_order), 0) + 10 from public.attendance_event_kinds k)),
    coalesce(p_archived, false))
  on conflict (kind) do update
    set label = excluded.label,
        board = excluded.board,
        -- Editing without a position keeps the one it has.
        sort_order = coalesce(p_sort_order, public.attendance_event_kinds.sort_order),
        -- Left out, the flag is left as it is: an edit must not un-archive.
        archived = coalesce(p_archived, public.attendance_event_kinds.archived);
end;
$$;

revoke all on function public.save_event_kind(text, text, text, int, boolean) from public, anon;
grant execute on function public.save_event_kind(text, text, text, int, boolean) to authenticated;

comment on function public.save_event_kind(text, text, text, int, boolean) is
  'Add an event or edit its name, tab, order and archived flag. catalogue.write. '
  'Never changes `captured`. 0240.';

-- ---------------------------------------------------------------------------
-- Say an event was held on a day, or take that back.

create function public.declare_event_day(
  p_kind text,
  p_held_on date,
  p_note text default null,
  p_declared boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_permission('data.enter') then
    raise exception 'declaring an event day requires the data.enter permission'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.attendance_event_kinds where kind = p_kind) then
    raise exception 'there is no event called %', p_kind using errcode = '22023';
  end if;
  if p_held_on is null then
    raise exception 'the day the event was held is required' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'a note is at most 200 characters' using errcode = '22023';
  end if;

  if p_declared is false then
    -- A row with no alliance belongs to the primary (0212), so match it that way.
    delete from public.attendance_event_days d
     where d.kind = p_kind
       and d.held_on = p_held_on
       and coalesce(d.alliance_id, (select public.primary_own_alliance()))
           is not distinct from v_alliance;
    return;
  end if;

  if p_held_on > (now() at time zone 'UTC' - interval '2 hours')::date then
    raise exception 'that day has not happened yet' using errcode = '22023';
  end if;
  if (select k.archived from public.attendance_event_kinds k where k.kind = p_kind) then
    raise exception 'that event is archived' using errcode = '22023';
  end if;

  -- Already declared (including a seeded primary row with no alliance): keep
  -- the row and just take the new note, rather than adding a second one.
  update public.attendance_event_days d
     set note = coalesce(v_note, d.note)
   where d.kind = p_kind
     and d.held_on = p_held_on
     and coalesce(d.alliance_id, (select public.primary_own_alliance()))
         is not distinct from v_alliance;
  if not found then
    insert into public.attendance_event_days (alliance_id, kind, held_on, note)
    values (v_alliance, p_kind, p_held_on, v_note);
  end if;
end;
$$;

revoke all on function public.declare_event_day(text, date, text, boolean) from public, anon;
grant execute on function public.declare_event_day(text, date, text, boolean) to authenticated;

comment on function public.declare_event_day(text, date, text, boolean) is
  'Say an event was held on a game day for the alliance on screen, or (with '
  'p_declared false) take that back. data.enter. 0240.';
