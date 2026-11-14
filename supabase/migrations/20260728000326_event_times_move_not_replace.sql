-- 0326: a Siege / Frankie / Black Gold pick that changes day MOVES its entry.
--
-- 0249 turned the alliance's own picks into `captured` entries keyed
-- `<event_key>:<slot>:<server day>`. When a pick moved to another server day
-- while the old entry was still ahead, it DELETED that entry and inserted a new
-- one - which threw away the officer's alarm message, turned-off steps and send
-- history (all hang off the entry's id).
--
-- Now the soonest future entry of that event and slot is moved in place: it
-- gets the new key and times and keeps its id, so everything attached to it
-- stays. This is how "a pick that moves to another server day is a move, not a
-- new event" is realised here. It does not re-key by the game's activity
-- window: the trigger already treats every future entry with the same event and
-- slot as the one being replaced, so moving that row is enough, and existing
-- keys need no data migration. Any further future entries of that event and
-- slot are deleted as before.
--
-- Also: captured entries no longer get body = 'Read from the game.'. Existing
-- ones are cleared below.
--
-- Everything else in the function is 0249's, unchanged: the same guards, the
-- out-of-order check, grants, security definer, and warn-never-raise.

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
  -- A time long past is history the board does not need, and a row with no
  -- alliance has no board to go on.
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
  -- Server time is UTC-2, and the game's day turns over there.
  v_key := new.event_key || ':' || new.slot || ':'
           || to_char((new.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD');

  -- Snapshots can arrive out of order after an outage: the newest reading of
  -- this event, slot and server day is the one the entry shows.
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

  -- The pick moved to another day while the old one was still ahead: that entry
  -- is the same event, now at a new time. Move it (keeping its id, message,
  -- steps and history) rather than replace it. If this day already has an entry
  -- there is nothing to move into it, and the insert below updates that one.
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
          and o.source_key like new.event_key || ':' || new.slot || ':%'
          and o.source_key <> v_key
          and o.starts_at > now()
        order by o.starts_at
        limit 1);
  end if;

  -- Any other future entry of this event and slot is no longer true.
  delete from public.schedule_events e
   where e.alliance_id = new.alliance_id
     and e.source = 'captured'
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
        updated_at = now();
  return new;
exception when others then
  raise warning 'apply_alliance_event_time: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

-- create or replace keeps the grants 0249 set; stated again so this file is
-- self-explanatory.
revoke all on function internal.apply_alliance_event_time() from public, anon, authenticated;

update public.schedule_events
   set body = null
 where source = 'captured' and body = 'Read from the game.';
