-- 0306: every alliance shown with its tag.
--
-- The dashboard writes an alliance as `[TAG] Name` everywhere it has both. The three
-- Migration screens could not: their functions hand back the name alone, from the state
-- list's `allianceName` (only in `raw`, behind `migration_list_alliance`, 0292) or from
-- `alliances.current_name` for a roster sighting.
--
-- `alliance_name` therefore now carries the finished label, so the result shapes and the
-- client stay as they are. `alliance_label` is the one place the format lives (the same as
-- `allianceLabel` in the dashboard's season boards): name alone when there is no tag, tag
-- alone when there is no name, null for neither. A state list names the tag `abbr`.
--
-- Replaced, all with unchanged signatures and result types: `migration_list_alliance`
-- (read by the candidate lookup, the tier board, the seen lookup and the movers),
-- `migration_movers` (0303) and `migration_candidate_seen` (0297), whose roster branches
-- read `alliances` directly.

create function public.alliance_label(p_name text, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_name), '') is not null and nullif(btrim(p_code), '') is not null
      then '[' || btrim(p_code) || '] ' || btrim(p_name)
    else coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_code), ''))
  end;
$$;

grant execute on function public.alliance_label(text, text) to authenticated, service_role;

comment on function public.alliance_label(text, text) is
  'An alliance as people write it: [TAG] Name; either part alone when the other is missing (0306).';

create or replace function public.migration_list_alliance(p_player uuid, p_observation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.alliance_label(s.raw ->> 'allianceName', s.raw ->> 'abbr')
    from public.player_snapshots s
   where (select public.has_permission('migration.manage'))
     and s.player_id = p_player
     and s.observation_id = p_observation
   limit 1;
$$;

create or replace function public.migration_movers(
  p_from_server int default 565,
  p_to_server int default 588,
  p_board_from int default 567,
  p_board_to int default 588,
  p_since interval default interval '30 days'
)
returns table (
  game_uid bigint,
  name text,
  home_server int,
  server_id int,
  alliance_name text,
  power bigint,
  board_rank bigint,
  captured_at timestamptz,
  source text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lists as (
    select s.observation_id, min(s.server_id) as server_id, max(s.captured_at) as at
      from public.player_snapshots s
     where s.source_command in ('cross.server.rank', 'server.rank')
       and s.server_id between p_from_server and p_to_server
       and s.captured_at > now() - p_since
     group by s.observation_id
    having min(s.server_id) = max(s.server_id)
  ),
  newest as (
    select distinct on (server_id) server_id, observation_id
      from lists
     order by server_id, at desc
  ),
  listed as (
    select s.player_id, s.observation_id, s.game_uid, s.name, s.server_id, s.power, s.captured_at
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
     where s.source_command in ('cross.server.rank', 'server.rank')
  ),
  board as (
    select l.power from listed l where l.server_id between p_board_from and p_board_to
  ),
  from_lists as (
    select l.game_uid, l.name, l.server_id,
           public.migration_list_alliance(l.player_id, l.observation_id) as alliance_name,
           l.power, l.captured_at, 'list'::text as source
      from listed l
     where (l.game_uid % 1000000) <> l.server_id
  ),
  -- Every roster row of a player on another server than their uid names, newest first.
  from_rosters as (
    select distinct on (m.game_uid)
           m.game_uid, m.name, m.server_id, public.alliance_label(a.current_name, a.current_code) as alliance_name,
           m.power, m.captured_at, 'roster'::text as source
      from public.alliance_member_snapshots m
      join public.alliances a on a.alliance_id = m.alliance_id
     where m.server_id between p_from_server and p_to_server
       and m.captured_at > now() - p_since
       and (m.game_uid % 1000000) <> m.server_id
     order by m.game_uid, m.captured_at desc
  ),
  seen as (
    select distinct on (u.game_uid) u.*
      from (select * from from_lists union all select * from from_rosters) u
     order by u.game_uid, u.captured_at desc, (u.source <> 'list')
  )
  select s.game_uid, s.name, (s.game_uid % 1000000)::int, s.server_id, s.alliance_name,
         s.power,
         (select count(*) + 1 from board b where b.power > s.power),
         s.captured_at, s.source
    from seen s
   order by s.power desc nulls last, s.game_uid;
$$;

create or replace function public.migration_candidate_seen(
  p_names text[] default '{}',
  p_uids bigint[] default '{}',
  p_from_server int default 567,
  p_to_server int default 588
)
returns table (
  game_uid bigint,
  name text,
  server_id int,
  alliance_name text,
  power bigint,
  captured_at timestamptz,
  source_command text,
  estimated_rank bigint,
  migrate_power bigint,
  migrate_power_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with matched as (
    select p.player_id
      from public.players p
     where p.game_uid = any (p_uids)
        or lower(btrim(p.current_name)) in (select lower(btrim(n)) from unnest(p_names) as n)
  ),
  snap as (
    select distinct on (s.player_id)
           s.player_id, s.observation_id, s.game_uid, s.name, s.server_id, s.power,
           s.captured_at, s.source_command
      from public.player_snapshots s
      join matched m on m.player_id = s.player_id
     where s.power is not null
     order by s.player_id, s.captured_at desc
  ),
  roster as (
    select p.player_id, p.game_uid, p.current_name as name, p.server_id, p.power,
           coalesce(p.roster_observed_at, p.last_seen_at, p.updated_at) as captured_at,
           public.alliance_label(a.current_name, a.current_code) as alliance_name
      from public.players p
      join matched m on m.player_id = p.player_id
      join public.player_current_alliance() c on c.player_id = p.player_id
      left join public.alliances a on a.alliance_id = c.alliance_id
     where p.power is not null
  ),
  latest as (
    select coalesce(r.player_id, s.player_id) as player_id,
           s.observation_id,
           coalesce(s.game_uid, r.game_uid) as game_uid,
           case when r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at)
                then r.name else s.name end as name,
           case when r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at)
                then r.server_id else s.server_id end as server_id,
           case when r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at)
                then r.power else s.power end as power,
           case when r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at)
                then r.captured_at else s.captured_at end as captured_at,
           case when r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at)
                then 'roster' else s.source_command end as source_command,
           r.alliance_name as roster_alliance,
           (r.player_id is not null and (s.player_id is null or r.captured_at > s.captured_at))
             as from_roster
      from snap s
      full join roster r on r.player_id = s.player_id
  ),
  lists as (
    select s.observation_id, min(s.server_id) as server_id, max(s.captured_at) as at
      from public.player_snapshots s
     where s.source_command in ('cross.server.rank', 'server.rank')
       and s.server_id between p_from_server and p_to_server
       and s.captured_at > now() - interval '30 days'
     group by s.observation_id
    having min(s.server_id) = max(s.server_id)
  ),
  newest as (
    select distinct on (server_id) server_id, observation_id
      from lists
     order by server_id, at desc
  ),
  board as (
    select s.power
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
  )
  select l.game_uid, l.name, l.server_id,
         case when l.from_roster then l.roster_alliance
              else coalesce(public.migration_list_alliance(l.player_id, l.observation_id),
                            l.roster_alliance) end,
         l.power, l.captured_at, l.source_command,
         (select count(*) + 1 from board b where b.power > l.power),
         m.power, m.captured_at
    from latest l
    left join lateral (
      select h.power, h.captured_at
        from public.player_component_power_history h
       where h.player_id = l.player_id and h.metric = 'migrate_power'
       order by h.captured_at desc
       limit 1
    ) m on true
   order by l.power desc;
$$;
