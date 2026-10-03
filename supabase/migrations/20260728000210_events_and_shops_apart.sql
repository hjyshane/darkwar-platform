-- The game calendar mixes gameplay events with shops, packs and passes.
--
-- The game files its events on tabs ("Hot", "Regular", "State Wars") that do
-- not separate them — "Hot" holds Shadow Calls next to a Battle Pass — but
-- every event also has an activity type in the client's activity_panel table,
-- and that does: passes and gifts, packs, shops and markets, and gacha draws
-- are their own types. `dw-collector game-names` writes the type and a
-- category from it (gamedata/names.py, SHOP_TYPES); an officer renaming an
-- event can change the category, and a person's choice is not overwritten.
--
-- category is 'event' or 'shop'. Null means nobody — tool or person — has
-- classified it, which the calendar shows under Events.

alter table public.event_names
  add column activity_type int,
  add column category text check (category is null or category in ('event', 'shop'));

-- A person's edit must stay a person's. event_names.updated_by defaulted to
-- auth.uid() on INSERT only, so an officer renaming a row the game tool wrote
-- (updated_by null) left it null, and the next `game-names` run — which
-- refreshes every null-owner row — would have put the game's name back. Any
-- write made by a signed-in user records that user; the collector's key has
-- no auth.uid(), so its own writes leave the row refreshable.
create function internal.event_names_mark_editor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger event_names_mark_editor
  before insert or update on public.event_names
  for each row execute function internal.event_names_mark_editor();

-- The view gains the two columns. Dropped and recreated rather than replaced
-- because the new columns go beside the name, not at the end.
drop view public.event_schedule_current;

create view public.event_schedule_current
with (security_invoker = true) as
with latest as (
  select distinct on (s.server_id) s.server_id, s.captured_at, s.events
  from public.event_schedule_snapshots s
  order by s.server_id, s.captured_at desc
)
select
  l.server_id,
  e ->> 'id' as activity_id,
  n.name,
  n.category,
  n.activity_type,
  public.epoch_ms_to_timestamptz(e -> 'startTime') as starts_at,
  public.epoch_ms_to_timestamptz(e -> 'endTime') as ends_at,
  (e ->> 'needMainCityLevel')::int as need_hq_level,
  (e ->> 'subType')::int as sub_type,
  e - array['id', 'startTime', 'endTime', 'needMainCityLevel', 'subType'] as detail,
  l.captured_at as seen_at
from latest l
cross join lateral jsonb_array_elements(l.events) as e
left join public.event_names n on n.activity_id = e ->> 'id';

revoke all on public.event_schedule_current from anon, authenticated;
grant select on public.event_schedule_current to authenticated;
grant select on public.event_schedule_current to service_role;
