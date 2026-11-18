-- 0332: a Black Gold plan reads ITS OWN alliance's signup list.
--
-- 0331 took "the newest signup reading on the alliance's server" as the
-- starter list, both in save_bgb_plan and in the panel. A reading
-- (dragon.assign.player.info) lists every member of the READER's alliance,
-- and black_money_signup_snapshots carries no alliance id — only each
-- member's server and alliance_abbr. So the moment a second own alliance
-- (multi-alliance, 2026-09-28) sits on the same server and its collector
-- opens the signup screen, the newest reading on that server is THEIRS:
-- our officers would be shown the other alliance's starters, and the save
-- would refuse our own starters as "not a starter of this team".
--
-- WHICH READING IS OURS. Membership comes from the roster
-- (alliance_member_snapshots' newest batch for the alliance, which is what
-- alliance_roster_latest reads), never from players.current_alliance_id. A
-- reading is ours when MORE THAN HALF of the players it names are on our
-- roster: a reading lists the whole alliance, so ours carries nearly all of
-- the roster, while another alliance's carries at most the odd player who
-- moved between the two since our roster was last read. Majority rather
-- than "any member appears" for exactly that player. A player who joined
-- after our last roster read is still in the reading and still placeable —
-- the roster only picks the batch, it does not filter it.
--
-- Read directly from alliance_member_snapshots, not through
-- alliance_roster_latest, because that view gates on current_app_role()
-- and the helper is shared by a member-callable read and the officer save.
--
-- WHAT IS NOT CHANGED. Starters only, the newest of our readings, judged at
-- write time — 0331's rules. black_money_battles (0181) pairs a battle with
-- a reading by server too; it is a different screen and is left alone here.

-- ---------------------------------------------------------------------------
-- The newest reading that is this alliance's, or null when none is.

create function internal.bgb_signup_read_at(p_alliance_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with roster as (
    select m.player_id
      from public.alliance_member_snapshots m
     where m.alliance_id = p_alliance_id
       and m.captured_at = (select max(n.captured_at)
                              from public.alliance_member_snapshots n
                             where n.alliance_id = p_alliance_id)
       and m.player_id is not null
  ),
  readings as (
    select distinct s.captured_at
      from public.black_money_signup_snapshots s
     where s.server_id = (select al.server_id from public.alliances al
                           where al.alliance_id = p_alliance_id)
  )
  select r.captured_at
    from readings r
   where (select count(*) filter (where s.player_id in (select player_id from roster)) * 2
                 > count(*)
            from public.black_money_signup_snapshots s
           where s.server_id = (select al.server_id from public.alliances al
                                 where al.alliance_id = p_alliance_id)
             and s.captured_at = r.captured_at
             and s.player_id is not null)
   order by r.captured_at desc
   limit 1;
$$;

revoke all on function internal.bgb_signup_read_at(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the panel reads: the team's starters in the alliance-being-viewed's
-- newest reading, and when that reading was taken. One object, so "no
-- reading yet" (read_at null) and "a reading with nobody on this team"
-- (an empty list) stay different answers.

create function public.bgb_starters(p_team_index int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := coalesce(public.active_alliance(), public.primary_own_alliance());
  v_server int;
  v_read timestamptz;
begin
  -- The same gate as the signup table's own policy (0178).
  if public.current_app_role() not in ('member', 'officer', 'admin')
     or public.current_app_role() is null then
    raise exception 'members only' using errcode = '42501';
  end if;
  select al.server_id into v_server from public.alliances al where al.alliance_id = v_alliance;
  v_read := internal.bgb_signup_read_at(v_alliance);
  return jsonb_build_object(
    'read_at', v_read,
    'starters', coalesce((
      select jsonb_agg(jsonb_build_object('player_id', s.player_id, 'name', s.name,
                                          'power', s.power)
                       order by s.power desc nulls last)
        from public.black_money_signup_snapshots s
       where s.server_id = v_server
         and s.captured_at = v_read
         and s.team_index = p_team_index
         and s.state = 1
         and s.player_id is not null), '[]'::jsonb));
end;
$$;

revoke all on function public.bgb_starters(int) from public, anon;
grant execute on function public.bgb_starters(int) to authenticated;

-- ---------------------------------------------------------------------------
-- save_bgb_plan, copied from 0331 with only the choice of reading changed.

create or replace function public.save_bgb_plan(
  p_plan_id uuid,
  p_version int,
  p_name text,
  p_note text,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.bgb_plans;
  v_server int;
  v_read timestamptz;
  v_stranger uuid;
begin
  v_plan := internal.bgb_plan_lock(p_plan_id);
  if v_plan.deleted_at is not null then
    raise exception 'this plan was deleted' using errcode = 'P0002';
  end if;
  if p_version is distinct from v_plan.version then
    raise exception 'somebody else saved this plan after you opened it'
      using errcode = 'PT409';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'the people must be a json array of {objective_key, player_id, role, ordinal}'
      using errcode = '22023';
  end if;
  if p_name is not null and length(btrim(p_name)) = 0 then
    raise exception 'a plan needs a name' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(player_id uuid)
     group by a.player_id having count(*) > 1 or a.player_id is null
  ) then
    raise exception 'a player appears twice, or without an id, in one save'
      using errcode = '22023';
  end if;

  select al.server_id into v_server
    from public.alliances al
   where al.alliance_id = coalesce(v_plan.alliance_id, public.primary_own_alliance());
  v_read := internal.bgb_signup_read_at(coalesce(v_plan.alliance_id, public.primary_own_alliance()));

  select a.player_id into v_stranger
    from jsonb_to_recordset(p_assignments) as a(player_id uuid)
   where not exists (
     select 1 from public.black_money_signup_snapshots s
      where s.server_id = v_server
        and s.captured_at = v_read
        and s.player_id = a.player_id
        and s.team_index = v_plan.team_index
        and s.state = 1)
   limit 1;
  if v_stranger is not null then
    raise exception 'only a starter of this team can be placed (player %)', v_stranger
      using errcode = '22023';
  end if;

  delete from public.bgb_plan_assignments where plan_id = p_plan_id;
  insert into public.bgb_plan_assignments (plan_id, objective_key, player_id, role, ordinal)
  select p_plan_id, a.objective_key, a.player_id, coalesce(a.role, ''), coalesce(a.ordinal, 0)
    from jsonb_to_recordset(p_assignments)
           as a(objective_key text, player_id uuid, role text, ordinal int);

  update public.bgb_plans
     set name = coalesce(btrim(p_name), name),
         note = coalesce(p_note, note),
         version = version + 1
   where plan_id = p_plan_id;
  perform internal.bgb_plan_stamp(p_plan_id);

  return (
    select jsonb_build_object(
             'version', p.version,
             'edited_at', p.edited_at,
             'edited_by_name', p.edited_by_name)
      from public.bgb_plans p
     where p.plan_id = p_plan_id);
end;
$$;

