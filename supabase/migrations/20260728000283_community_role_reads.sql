-- 0283: what the 'community' role (0282) may read.
--
-- An ALLOWLIST. The role is for people outside the alliance, so every table
-- below is game-wide reference or cross-server public data; every table that
-- holds OUR alliance (roster, contributions, presence, notices, guides,
-- captured event times, hive plans, favourites, sync and collector status)
-- is left exactly as it was and stays closed to it.
--
-- Pages this serves: overview (scanned servers), rankings, migration, map,
-- planner, game calendar, event guide, shop value.
--
-- HOW. Each listed table has one or more SELECT policies that name
-- member/officer/admin. They are altered in place rather than rewritten from
-- the migrations that made them, because several were rewritten more than
-- once (0065, 0107, 0194...) and the deployed text is the one that matters.
-- The loop fails loudly when a listed table has nothing to widen, so a rename
-- cannot turn this into a silent no-op.

do $$
declare
  v_tables text[] := array[
    -- who is who, cross-server
    'servers', 'alliances', 'alliance_names', 'alliance_snapshots',
    'alliance_latest_current', 'players', 'player_names', 'player_snapshots',
    'player_component_power_snapshots',
    -- arena boards (Rankings)
    'arena_snapshots', 'arena_entries', 'arena_entry_heroes', 'arena_matches',
    -- map
    'world_city_snapshots', 'world_viewport_snapshots', 'world_truck_snapshots',
    'dispatch_mission_snapshots', 'game_dispatch_missions', 'game_train_stations',
    -- migration (server-level: events, quotas, rules)
    'migration_events', 'migration_server_snapshots', 'migration_config_snapshots',
    -- calendar, event guide
    'event_schedule_snapshots', 'event_names', 'game_event_themes',
    'game_event_scores', 'game_event_calendar', 'game_season_snapshots',
    -- planner
    'game_upgrade_steps', 'game_items', 'game_resources', 'game_research_tabs',
    'game_hero_gear', 'game_effects', 'heroes', 'pets',
    -- shop value
    'shop_pack_snapshots', 'shop_pack_catalogs', 'shop_listing_snapshots',
    'game_item_values', 'game_item_names', 'game_pack_names', 'game_pack_picks',
    -- shared game data
    'game_strings', 'game_icons', 'game_icon_refs', 'ui_overrides',
    -- the grid the dashboard reads to decide what to offer
    'capabilities', 'role_permissions'
  ];
  v_table text;
  v_policy record;
  v_new text;
  v_changed int;
begin
  foreach v_table in array v_tables loop
    v_changed := 0;
    for v_policy in
      select policyname, qual
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and qual like '%app_role%'
    loop
      if v_policy.qual like '%''community''%' then
        v_changed := v_changed + 1;
        continue;
      end if;
      -- member/officer/admin lists: add it after 'member'. officer/admin lists
      -- (migration_*): add it before 'officer'. The cast is schema-qualified or
      -- not depending on search_path, so match both.
      v_new := regexp_replace(
        v_policy.qual,
        '''member''::((public\.)?app_role)',
        '''member''::\1, ''community''::\1');
      if v_new = v_policy.qual then
        v_new := regexp_replace(
          v_policy.qual,
          '''officer''::((public\.)?app_role)',
          '''community''::\1, ''officer''::\1');
      end if;
      if v_new = v_policy.qual then
        continue;
      end if;
      execute format('alter policy %I on public.%I using (%s)',
                     v_policy.policyname, v_table, v_new);
      v_changed := v_changed + 1;
    end loop;

    if v_changed = 0 then
      raise exception '0283: % has no SELECT policy to widen for community', v_table;
    end if;
  end loop;
end;
$$;

-- Rosters, other alliances' only. 0066 made alliance_member_snapshots
-- own-or-officer because a roster says who belongs where; the migration board
-- is read off those rosters. Everything except our own alliances' rows, so
-- the board works and our own member list is never in it.
create policy community_read_other_alliances on public.alliance_member_snapshots
  for select to authenticated
  using (
    (select public.current_app_role()) = 'community'
    and alliance_id not in (select a.alliance_id from public.alliances a where a.is_own)
  );

-- A column in the grid, all off, so the permissions screen shows the role and
-- has_permission() answers false for it explicitly rather than by absence.
-- The default row (alliance_id null); 0200's trigger fans it out to each own
-- alliance.
insert into public.role_permissions (role, capability, allowed, alliance_id)
select 'community'::public.app_role, c.capability, false, null
from public.capabilities c
on conflict (role, capability, alliance_id) do nothing;

-- Rankings has an Arena board behind this capability (0064): cross-server
-- data, so the one capability the role is given.
update public.role_permissions set allowed = true
where role = 'community' and capability = 'arena.view';

-- Join codes can grant it. The check was belt and braces for "no path to
-- admin"; community is not a path to anything.
alter table public.join_codes drop constraint join_codes_grantable_role;
alter table public.join_codes add constraint join_codes_grantable_role
  check (grants_role in ('member', 'officer', 'community'));

-- 0193's body, plus one branch. A community code is global, not per alliance:
-- it sets the account's role and writes no membership (0192's mirror only
-- makes memberships for member/officer, and a community account belongs to no
-- alliance). It still never downgrades: an account that already has a role
-- above viewer keeps it.
create or replace function public.redeem_join_code(p_code text)
returns public.app_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role;
  v_code_id uuid;
  v_alliance uuid;
  v_current public.app_role;
  v_failed int;
  v_window_start timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in before redeeming a code' using errcode = '28000';
  end if;

  select failed_count, first_failed_at into v_failed, v_window_start
  from public.join_code_attempts where user_id = v_uid;

  if v_failed is not null and v_window_start > now() - interval '1 hour' and v_failed >= 5 then
    raise exception 'too many attempts; try again later' using errcode = '54000';
  end if;

  select code_id, grants_role, coalesce(alliance_id, public.primary_own_alliance())
    into v_code_id, v_role, v_alliance
  from public.join_codes
  where code = p_code
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (max_uses is null or used_count < max_uses)
  for update;

  if v_code_id is null or v_role not in ('member', 'officer', 'community') then
    insert into public.join_code_attempts as a (user_id, failed_count)
    values (v_uid, 1)
    on conflict (user_id) do update
    set failed_count = case
          when a.first_failed_at > now() - interval '1 hour' then a.failed_count + 1
          else 1
        end,
        first_failed_at = case
          when a.first_failed_at > now() - interval '1 hour' then a.first_failed_at
          else now()
        end,
        last_failed_at = now();
    return null;
  end if;

  select role into v_current from public.app_users where user_id = v_uid;

  if v_current in ('admin', 'collector_service', 'analyst_service') then
    return v_current;
  end if;

  if v_role = 'community' then
    if v_current is null then
      insert into public.app_users (user_id, role) values (v_uid, 'community');
    elsif v_current = 'viewer' then
      update public.app_users set role = 'community' where user_id = v_uid;
    else
      -- Already community, member or officer: nothing to grant, nothing
      -- downgraded, and the code is not spent.
      return v_current;
    end if;
  elsif v_alliance is null or v_alliance = public.primary_own_alliance() then
    if v_current is null then
      insert into public.app_users (user_id, role) values (v_uid, v_role);
    elsif v_current in ('viewer', 'community') then
      -- A community account that is admitted to the alliance is promoted.
      update public.app_users set role = v_role where user_id = v_uid;
    else
      return v_current;
    end if;
  else
    if exists (select 1 from public.alliance_memberships
                where user_id = v_uid and alliance_id = v_alliance) then
      return (select role from public.alliance_memberships
               where user_id = v_uid and alliance_id = v_alliance);
    end if;
    if v_current is null then
      insert into public.app_users (user_id, role) values (v_uid, 'viewer');
    end if;
    insert into public.alliance_memberships (user_id, alliance_id, role)
    values (v_uid, v_alliance, v_role);
  end if;

  update public.join_codes set used_count = used_count + 1 where code_id = v_code_id;
  delete from public.join_code_attempts where user_id = v_uid;

  return v_role;
end;
$$;

-- Claiming a character. The planner reads account_state_* through the
-- caller's own user_players rows, so a community account that cannot claim
-- one has an empty planner. 0193's body with 'community' admitted.
create or replace function public.claim_player(p_player_id uuid)
returns public.player_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_claim public.player_claims;
begin
  if v_uid is null then
    raise exception 'sign in to say which character you are' using errcode = '42501';
  end if;

  if public.current_app_role() not in ('member', 'officer', 'admin', 'community') then
    raise exception 'members only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.players where player_id = p_player_id) then
    raise exception 'no such player' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.user_players
              where player_id = p_player_id and user_id <> v_uid)
     or exists (select 1 from public.app_users
                 where player_id = p_player_id and user_id <> v_uid) then
    raise exception 'that player is already linked to another account'
      using errcode = '23505';
  end if;

  -- A claim is immediate and opens that character's own account state. A
  -- community account must not be able to take one of OUR members' characters
  -- before they do. current_alliance_id is a last-known alliance (it is never
  -- cleared), so this also refuses someone who left: conservative on purpose.
  if public.current_app_role() = 'community'
     and exists (select 1
                   from public.players p
                   join public.alliances a on a.alliance_id = p.current_alliance_id
                  where p.player_id = p_player_id and a.is_own) then
    raise exception 'that character belongs to the alliance and cannot be claimed here'
      using errcode = '42501';
  end if;

  insert into public.user_players (player_id, user_id)
  values (p_player_id, v_uid)
  on conflict (player_id) do nothing;

  update public.app_users set player_id = p_player_id
  where user_id = v_uid and player_id is null;

  insert into public.player_claims as pc
    (user_id, player_id, status, decided_at, decided_by, alliance_id)
  values (v_uid, p_player_id, 'approved', now(), v_uid, public.active_alliance())
  on conflict (user_id) do update
    set player_id = excluded.player_id,
        status = 'approved',
        note = null,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        alliance_id = excluded.alliance_id
  returning * into v_claim;

  return v_claim;
end;
$$;
