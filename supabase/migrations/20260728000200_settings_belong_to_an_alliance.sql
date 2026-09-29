-- Every setting belongs to an alliance, except the catalogue.
--
-- Settings was half-split: rank tiers and Discord followed the alliance on
-- screen (0195, 0199), while the overview figures, member columns, table
-- layout, building alert and the permission grid were one row for the whole
-- install. An officer viewing ACE saw CBFW's grid, could edit it, and saw
-- CBFW's deliveries in the Discord log. What stays shared on purpose: the
-- hero and pet catalogues (facts about the game), and the install itself —
-- which alliances are pinned, the collectors, unrecognized commands.
--
--   * The four display keys join alliance_settings, the same way rank_tiers
--     did: the primary's value is app_settings, anybody else's is an override
--     that the pin freeze seeds from the primary's.
--   * role_permissions gains alliance_id. Every pinned alliance holds its own
--     full grid; rows with no alliance are the DEFAULTS a new capability is
--     seeded with, copied to every pinned alliance as they are inserted, so a
--     future migration's `insert ... (role, capability, allowed)` still lands
--     everywhere. has_permission reads the alliance on screen's row.
--     A future seed must say `on conflict do nothing` or name
--     (role, capability, alliance_id): the (role, capability) key is gone.
--   * app_settings is written directly only while viewing the primary (or by
--     an admin). Before this, anybody holding settings.write in ANY alliance
--     could rewrite the primary's rank tiers, its Discord routing and the pin
--     list through the table itself — harmless while only admins held it, and
--     not once a second alliance edits its own grid.
--   * The Discord delivery log shows the alliance on screen's deliveries.

alter table public.alliance_settings
  drop constraint alliance_settings_known_key;
alter table public.alliance_settings
  add constraint alliance_settings_known_key
  -- The same list is in save_alliance_setting() and freeze_alliance_settings().
  check (key in ('rank_tiers', 'discord_notifications',
                 'overview_metrics', 'member_formulas', 'table_layout',
                 'season_building_alert'));

-- ---------------------------------------------------------------------------
-- The permission grid, per alliance.

alter table public.role_permissions
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade;

comment on column public.role_permissions.alliance_id is
  'The alliance this grid row belongs to. Null rows are the defaults: copied '
  'to every pinned alliance when inserted, and read only for an alliance '
  'with no row of its own.';

alter table public.role_permissions drop constraint role_permissions_pkey;
alter table public.role_permissions
  add constraint role_permissions_role_capability_alliance_key
  unique nulls not distinct (role, capability, alliance_id);

-- Today's grid becomes every pinned alliance's own, so nobody's permissions
-- move. The rows it came from stay, as the defaults.
insert into public.role_permissions (role, capability, allowed, alliance_id)
select r.role, r.capability, r.allowed, a.alliance_id
from public.role_permissions r
cross join public.alliances a
where r.alliance_id is null
  and a.is_own;

create function public.role_permissions_fan_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.role_permissions (role, capability, allowed, alliance_id)
  select new.role, new.capability, new.allowed, a.alliance_id
  from public.alliances a
  where a.is_own
  on conflict (role, capability, alliance_id) do nothing;
  return null;
end;
$$;

revoke all on function public.role_permissions_fan_out() from public, anon, authenticated;

create trigger role_permissions_fan_out
  after insert on public.role_permissions
  for each row when (new.alliance_id is null)
  execute function public.role_permissions_fan_out();

create or replace function public.has_permission(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The alliance on screen's row; the default only where it has none (a
  -- viewer with no alliance, or an alliance pinned since the row was added).
  select coalesce(
    (select r.allowed
       from public.role_permissions r
      where r.role = public.current_app_role()
        and r.capability = p_capability
        and (r.alliance_id = public.active_alliance() or r.alliance_id is null)
      order by r.alliance_id nulls last
      limit 1),
    false)
$$;

-- Reading: the alliance on screen's grid and the defaults. anon has no
-- alliance to be on, so the defaults only.
create policy alliance_scope_read on public.role_permissions as restrictive
  for select to authenticated
  using (alliance_id is null or alliance_id = (select public.active_alliance()));
create policy defaults_only on public.role_permissions as restrictive
  for select to anon
  using (alliance_id is null);

-- Writing: the alliance on screen's rows only. The defaults are written by
-- migrations, not from a browser.
create policy alliance_scope_insert on public.role_permissions as restrictive
  for insert to authenticated
  with check (alliance_id = (select public.active_alliance()));
create policy alliance_scope_update on public.role_permissions as restrictive
  for update to authenticated
  using (alliance_id = (select public.active_alliance()))
  with check (alliance_id = (select public.active_alliance()));
create policy alliance_scope_delete on public.role_permissions as restrictive
  for delete to authenticated
  using (alliance_id = (select public.active_alliance()));

-- ---------------------------------------------------------------------------
-- app_settings is the primary's row (and the install's pin list). Direct
-- writes need the primary on screen, or an admin. Everybody else writes
-- through save_alliance_setting(), which runs as the owner. The pin list
-- itself is an admin's alone: it decides whose data every screen shows, and
-- a pin change copies grids and settings between alliances.

create policy primary_only_insert on public.app_settings as restrictive
  for insert to authenticated
  with check ((select public.current_app_role()) = 'admin'
              or ((select public.active_alliance())
                  is not distinct from (select public.primary_own_alliance())
                  and key <> 'own_alliance'));
create policy primary_only_update on public.app_settings as restrictive
  for update to authenticated
  using ((select public.current_app_role()) = 'admin'
         or ((select public.active_alliance())
             is not distinct from (select public.primary_own_alliance())
             and key <> 'own_alliance'))
  with check ((select public.current_app_role()) = 'admin'
              or ((select public.active_alliance())
                  is not distinct from (select public.primary_own_alliance())
                  and key <> 'own_alliance'));
create policy primary_only_delete on public.app_settings as restrictive
  for delete to authenticated
  using ((select public.current_app_role()) = 'admin'
         or ((select public.active_alliance())
             is not distinct from (select public.primary_own_alliance())
             and key <> 'own_alliance'));

-- ---------------------------------------------------------------------------
-- The delivery log: the alliance on screen's channels. A channel with no
-- alliance, or one since deleted, is the primary's — collector alarms and
-- everything sent before 0199 went there.

create function public.notification_channel_alliance(p_channel text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.alliance_id from public.notification_channels c where c.channel = p_channel),
    public.primary_own_alliance())
$$;

revoke all on function public.notification_channel_alliance(text) from public, anon;
grant execute on function public.notification_channel_alliance(text) to authenticated, service_role;

comment on function public.notification_channel_alliance(text) is
  'The alliance a Discord channel name belongs to; the primary for a name '
  'with no row. Definer so the outbox policy sees past notification_channels'' '
  'own scope.';

create policy alliance_scope on public.notification_outbox as restrictive
  for all to authenticated
  using (public.notification_channel_alliance(channel)
         is not distinct from (select public.active_alliance()))
  with check (public.notification_channel_alliance(channel)
              is not distinct from (select public.active_alliance()));

-- The settings writer accepts the four display keys.

create or replace function public.save_alliance_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if not public.has_permission('settings.write') then
    raise exception 'changing settings requires settings.write' using errcode = '42501';
  end if;
  if p_key not in ('rank_tiers', 'discord_notifications',
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert') then
    raise exception 'not a per-alliance setting' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'a setting needs a value' using errcode = '22023';
  end if;

  -- The primary alliance's value IS app_settings: every reader not yet
  -- alliance-aware reads it there, and must keep seeing the primary's.
  if v_alliance is null or v_alliance = public.primary_own_alliance() then
    insert into public.app_settings (key, value, updated_by)
    values (p_key, p_value, (select auth.uid()))
    on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  else
    insert into public.alliance_settings (alliance_id, key, value, updated_by)
    values (v_alliance, p_key, p_value, (select auth.uid()))
    on conflict (alliance_id, key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  end if;
end;
$$;

-- A pin change copies the display keys and the permission grid too.

create or replace function public.freeze_alliance_settings(p_old_primary uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary uuid := public.primary_own_alliance();
begin
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, s.key, s.value, s.updated_by
  from public.alliances a
  cross join public.app_settings s
  where a.is_own
    and a.alliance_id is distinct from v_primary
    -- The per-alliance keys that start as a copy of the primary's: the
    -- list alliance_settings_known_key and save_alliance_setting carry,
    -- less Discord (below).
    and s.key in ('rank_tiers', 'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert')
  on conflict (alliance_id, key) do nothing;

  -- A display key the primary never saved has no shared row to copy, and
  -- "absent" means "read app_settings" — so the first time the primary
  -- saved one, every other alliance would change with it. '{}' reads as the
  -- built-in default to every parser of these four (absent and empty take
  -- the same path), and pins the other alliance to it.
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, k.key, '{}'::jsonb, null
  from public.alliances a
  cross join unnest(array['overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert']) as k(key)
  where a.is_own
    and a.alliance_id is distinct from v_primary
  on conflict (alliance_id, key) do nothing;

  -- The permission grid (0200): a newly pinned alliance starts with the
  -- primary's grid, as it starts with the primary's rank tiers. Explicit
  -- rows, so its officers edit their own and never the primary's.
  insert into public.role_permissions (role, capability, allowed, alliance_id)
  select r.role, r.capability, r.allowed, a.alliance_id
  from public.alliances a
  join public.role_permissions r
    on r.alliance_id is not distinct from v_primary
  where a.is_own
    and a.alliance_id is distinct from v_primary
  on conflict (role, capability, alliance_id) do nothing;
  -- And any capability the primary has no row for, from the defaults.
  insert into public.role_permissions (role, capability, allowed, alliance_id)
  select r.role, r.capability, r.allowed, a.alliance_id
  from public.alliances a
  join public.role_permissions r on r.alliance_id is null
  where a.is_own
  on conflict (role, capability, alliance_id) do nothing;

  -- DISCORD IS NOT COPIED to a newly pinned alliance. Its routing names
  -- channels, and the primary's channels are the primary's Discord: a copy
  -- would post the new alliance's notices into the other alliance's rooms.
  -- It starts empty (everything off) until its officers choose. The one
  -- exception is the alliance that WAS primary a moment ago: its routing is
  -- the shared row, and it keeps it.
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, 'discord_notifications',
         case when a.alliance_id = p_old_primary
              then coalesce((select s.value from public.app_settings s
                              where s.key = 'discord_notifications'), '{}'::jsonb)
              else '{}'::jsonb end,
         null
  from public.alliances a
  where a.is_own
    and a.alliance_id is distinct from v_primary
  on conflict (alliance_id, key) do nothing;

  -- A NEW primary that was never pinned before has no routing of its own,
  -- and the shared row still holds the OLD primary's rooms (copied to it just
  -- above). It starts empty, like any newly pinned alliance.
  if p_old_primary is not null
     and v_primary is distinct from p_old_primary
     and not exists (select 1 from public.alliance_settings o
                      where o.alliance_id = v_primary
                        and o.key = 'discord_notifications') then
    update public.app_settings set value = '{}'::jsonb
     where key = 'discord_notifications';
  end if;

  -- THEN the new primary's own values move into the shared row, and its
  -- override goes. Without this a promoted alliance would keep reading its
  -- override (alliance_setting prefers it) while its officers' edits land in
  -- app_settings (save_alliance_setting writes the primary's there) — every
  -- edit accepted and none of them taking effect. Second, so the copies
  -- above were taken from the OLD primary's values.
  -- An upsert, not an update: with no shared row yet, an update would do
  -- nothing and the delete below would throw the values away.
  insert into public.app_settings (key, value, updated_by)
  select o.key, o.value, o.updated_by
  from public.alliance_settings o
  where o.alliance_id = v_primary
    and o.key in ('rank_tiers', 'discord_notifications',
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert')
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by;
  delete from public.alliance_settings
   where alliance_id = v_primary
     and key in ('rank_tiers', 'discord_notifications',
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert');
end;
$$;

revoke all on function public.freeze_alliance_settings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The alliances already pinned get their display settings now: a copy of
-- what they were reading until this migration, which was the primary's.

select public.freeze_alliance_settings(null);
