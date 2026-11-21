-- 0342: alliance_trends - the alliance page's two judgement calls become a setting
--
-- The Activity tab of the alliance page counted "tower 35 or higher" and
-- measured growth "since the first capture". Both were fixed: 35 was written
-- into alliance_roster_history (0073), and the baseline was whichever capture
-- happened to be oldest. The owner asked to choose both in Settings.
--
--   * `alliance_trends` joins the per-alliance settings (0195, 0200), the same
--     way season_building_alert did: {"towerLevel": 35, "since": "2026-11-01"},
--     both optional, '{}' reading as the built-in defaults. The key is added to
--     the three places that carry the list: the check on alliance_settings,
--     save_alliance_setting() and freeze_alliance_settings(). Both functions
--     are 0200's bodies with the key added and nothing else changed.
--   * alliance_roster_history gains `hq_levels`: every member's tower level in
--     that capture, as one array. The page counts ">= the chosen level" from
--     it, so a new threshold needs no migration and no second round trip. An
--     array rather than a level -> count object because it is one more
--     aggregate in the pass the view already makes; a histogram would need a
--     second grouping of a view 0153 already had to speed up.
--
-- What this deliberately does not do: `members_at_hq35` stays, so a dashboard
-- deployed before or after this migration keeps working; nobody's access
-- changes (the view keeps 0077's predicate and 0187's definer setting, and the
-- settings writer keeps its settings.write gate); the start date is applied in
-- the browser, to rows the view already returns.

alter table public.alliance_settings
  drop constraint alliance_settings_known_key;
alter table public.alliance_settings
  add constraint alliance_settings_known_key
  -- The same list is in save_alliance_setting() and freeze_alliance_settings().
  check (key in ('rank_tiers', 'discord_notifications',
                 'overview_metrics', 'member_formulas', 'table_layout',
                 'season_building_alert', 'alliance_trends'));

-- The settings writer accepts the new key.

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
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert', 'alliance_trends') then
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

-- A pin change copies it, as it copies the other display keys.

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
    and s.key in ('rank_tiers', 'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert', 'alliance_trends')
  on conflict (alliance_id, key) do nothing;

  -- A display key the primary never saved has no shared row to copy, and
  -- "absent" means "read app_settings" — so the first time the primary
  -- saved one, every other alliance would change with it. '{}' reads as the
  -- built-in default to every parser of these five (absent and empty take
  -- the same path), and pins the other alliance to it.
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, k.key, '{}'::jsonb, null
  from public.alliances a
  cross join unnest(array['overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert', 'alliance_trends']) as k(key)
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
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert', 'alliance_trends')
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by;
  delete from public.alliance_settings
   where alliance_id = v_primary
     and key in ('rank_tiers', 'discord_notifications',
                  'overview_metrics', 'member_formulas', 'table_layout', 'season_building_alert', 'alliance_trends');
end;
$$;

-- ---------------------------------------------------------------------------
-- alliance_roster_history: 0077's body, with hq_levels added at the end (a
-- replaced view may only grow at the end). security_invoker is spelled out
-- because CREATE OR REPLACE resets a view's options, and 0187 set it.

create or replace view public.alliance_roster_history
with (security_invoker = false) as
select
  s.alliance_id,
  s.captured_at,
  count(*) as observed_members,
  a.member_count as expected_members,
  (a.member_count is null or count(*) >= a.member_count) as snapshot_complete,
  sum(s.power) as total_power,
  round(avg(s.power)) as avg_power,
  percentile_cont(0.5) within group (order by s.power) as median_power,
  max(s.power) as max_power,
  round(avg(s.hq_level)::numeric, 2) as avg_hq_level,
  max(s.hq_level) as max_hq_level,
  -- Counted rather than averaged: "how many are at the cap" is the question an
  -- officer actually asks about tower levels, and a mean hides it.
  count(*) filter (where s.hq_level >= 35) as members_at_hq35,
  sum(s.kills) as total_kills,
  count(*) filter (where s.member_rank >= 4) as officers,
  count(*) filter (where s.presence_redacted) as presence_unknown,
  -- Every known tower level in the capture, so the reader can count against
  -- whichever level the alliance chose (0342). Null levels are left out: a
  -- member whose level the capture did not carry is not "below" anything.
  array_agg(s.hq_level) filter (where s.hq_level is not null) as hq_levels
from public.alliance_member_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
group by s.alliance_id, s.captured_at, a.member_count;

-- ---------------------------------------------------------------------------
-- The alliances already pinned beside the primary get an empty override now,
-- so the first time the primary saves this setting theirs does not move. Only
-- this key: freeze_alliance_settings() would do it too, and a good deal else.

insert into public.alliance_settings (alliance_id, key, value, updated_by)
select a.alliance_id, 'alliance_trends', '{}'::jsonb, null
from public.alliances a
where a.is_own
  and a.alliance_id is distinct from public.primary_own_alliance()
on conflict (alliance_id, key) do nothing;
