-- 0347: settings_history - who changed which setting, from what, to what; and
-- the server group as something an admin can change.
--
-- WHY. Every settings table records only its latest state: app_settings and
-- alliance_settings carry updated_by and nothing else, and tab_visibility,
-- ui_overrides and role_permissions not even that. An admin who changes the
-- rank tiers by mistake cannot see what they were, and nobody can tell who
-- hid a tab from members. Since the settings registry (2026-11-24) makes
-- more of the site an admin's to change, the change itself has to leave a
-- trace and be undoable.
--
-- WHAT. One append-only table and one trigger function, attached to the six
-- tables whose rows are settings:
--
--   app_settings        item = key                    value = value
--   alliance_settings   item = key (+ alliance_id)    value = value
--   tab_visibility      item = tab_key:role           value = visible
--   ui_overrides        item = scope:key:kind         value = value
--   role_permissions    item = role:capability (+ alliance_id)   value = allowed
--   servers             item = server_id              value = is_tracked
--
-- Old and new values are stored as jsonb; an insert has no old value and a
-- delete no new one. An update that changes nothing (a Save with no edit,
-- or an updated_at bump) writes no row. The writer is auth.uid(): null for a
-- migration, sync, or anything else that is not a signed-in person.
--
-- UNDO is the client's: it writes the old value back through the same path
-- the form uses, under the same policies, and that write is itself a row
-- here. No revert function, so there is no second way to write a setting
-- that could disagree with the first.
--
-- READ by admins only. The values are no secret (app_settings is world-
-- readable), but who changed what, and when, is an admin's question.
--
-- THE SERVER GROUP. `servers.is_tracked` decides the group (0264), and since
-- 2026-11-24 the dashboard's server pickers read it. set_server_tracked()
-- lets an admin change it from Settings, including adding a server the
-- collector has not seen yet: the group grows (CLAUDE.md), and waiting for a
-- capture from the new server before it can be listed is backwards.
--
-- NOT HERE: retention (the volume is a few rows a day), a history of the
-- catalogue tables (heroes, pets, seasons, events: those are data entry, with
-- their own screens), and history before this migration.

create table public.settings_history (
  history_id bigint generated always as identity primary key,
  source text not null
    check (source in ('app_settings', 'alliance_settings', 'tab_visibility',
                      'ui_overrides', 'role_permissions', 'servers')),
  alliance_id uuid,
  item text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

comment on table public.settings_history is
  'Append-only: one row per change to a settings row (0347). Written only by '
  'record_settings_change(); readable by admins.';

create index settings_history_changed_at_idx
  on public.settings_history (changed_at desc);
create index settings_history_item_idx
  on public.settings_history (source, item, changed_at desc);

alter table public.settings_history enable row level security;
revoke all on public.settings_history from public, anon, authenticated;
grant select on public.settings_history to authenticated;
grant all on public.settings_history to service_role;

create policy admin_read on public.settings_history
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');

-- TG_ARGV[0]: the columns that name the row, comma-separated, joined with ':'.
-- TG_ARGV[1]: the column that holds the value.
create function public.record_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_item text;
  v_old_value jsonb := v_old -> tg_argv[1];
  v_new_value jsonb := v_new -> tg_argv[1];
begin
  if tg_op = 'UPDATE' and v_old_value is not distinct from v_new_value then
    return null;
  end if;
  select string_agg(v_row ->> k.col, ':' order by k.ord)
    into v_item
    from unnest(string_to_array(tg_argv[0], ',')) with ordinality as k(col, ord);
  insert into public.settings_history
    (source, alliance_id, item, old_value, new_value, changed_by)
  values
    (tg_table_name, (v_row ->> 'alliance_id')::uuid, v_item,
     v_old_value, v_new_value, (select auth.uid()));
  return null;
end;
$$;

revoke all on function public.record_settings_change() from public, anon, authenticated;

create trigger app_settings_history
  after insert or update or delete on public.app_settings
  for each row execute function public.record_settings_change('key', 'value');

create trigger alliance_settings_history
  after insert or update or delete on public.alliance_settings
  for each row execute function public.record_settings_change('key', 'value');

create trigger tab_visibility_history
  after insert or update or delete on public.tab_visibility
  for each row execute function public.record_settings_change('tab_key,role', 'visible');

create trigger ui_overrides_history
  after insert or update or delete on public.ui_overrides
  for each row execute function public.record_settings_change('scope,key,kind', 'value');

create trigger role_permissions_history
  after insert or update or delete on public.role_permissions
  for each row execute function public.record_settings_change('role,capability', 'allowed');

-- Insert too: a server the collector meets for the first time joins the
-- table untracked, and one an admin adds joins it tracked. Both are worth
-- seeing next to each other.
create trigger servers_history
  after insert or update of is_tracked on public.servers
  for each row execute function public.record_settings_change('server_id', 'is_tracked');

-- ---------------------------------------------------------------------------
-- The server group from Settings.

create function public.set_server_tracked(p_server_id integer, p_tracked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'changing the server group needs an admin' using errcode = '42501';
  end if;
  if p_tracked is null then
    raise exception 'say whether the server is tracked' using errcode = '22023';
  end if;
  if p_server_id is null or p_server_id < 1 or p_server_id > 9999 then
    raise exception 'not a server number' using errcode = '22023';
  end if;

  -- A server nobody has captured yet is added; sync's ensure_servers() would
  -- add it the same way, untracked, the first time it is seen.
  insert into public.servers (server_id, server_group, is_tracked)
  values (p_server_id, 'unknown', p_tracked)
  on conflict (server_id) do update set is_tracked = excluded.is_tracked;
end;
$$;

revoke all on function public.set_server_tracked(integer, boolean) from public, anon;
grant execute on function public.set_server_tracked(integer, boolean) to authenticated;

comment on function public.set_server_tracked(integer, boolean) is
  'Admin only: put a server in the tracked group or take it out (0347). Adds '
  'a server the collector has not seen yet.';
