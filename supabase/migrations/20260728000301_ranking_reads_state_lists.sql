-- 0301: the Cross-Server player ranking also reads the state lists.
--
-- `player_ranking_merged` built the power ranking from two things: the newest
-- `server.rank` board per COLLECTING server, and every player placed in an alliance whose
-- roster was captured. The Migration tab's state lists (`cross.server.rank`, one per
-- subject server, written since 2026-10-27) were in neither, so the strongest 150 players
-- of servers 566-576 appeared only through whatever roster had been opened - 21 days
-- ago, for the servers nobody had looked at since - while their lists, read at the start
-- of the migration, sat unused.
--
-- The newest state list of each server now joins the merge, and the existing rule picks
-- the newest sighting per player. Signature and columns are unchanged, so the page and
-- its grants are untouched.

create or replace function public.player_ranking_merged(p_metric text)
returns table (
  id uuid,
  player_id uuid,
  rank integer,
  name text,
  game_uid bigint,
  server_id integer,
  value bigint,
  captured_at timestamptz,
  source text
)
language sql
stable
set search_path = ''
as $$
  with cmd as (
    select case p_metric when 'power' then 'server.rank' when 'kills' then 'kill.rank' end as c
  ),
  newest as (
    select sv.server_id as from_server, n.captured_at
    from public.servers sv
    cross join cmd
    cross join lateral (
      select s.captured_at
      from public.player_snapshots s
      where s.source_command = cmd.c
        and s.collected_from_server_id = sv.server_id
      order by s.captured_at desc
      limit 1
    ) n
  ),
  board as (
    select s.snapshot_id as id, s.player_id, s.name, s.game_uid, s.server_id,
           case p_metric when 'power' then s.power else s.kills end as value,
           s.captured_at, 'board'::text as source
    from newest n
    cross join cmd
    join public.player_snapshots s
      on s.source_command = cmd.c
     and s.collected_from_server_id = n.from_server
     and s.captured_at = n.captured_at
  ),
  roster as (
    select p.player_id as id, p.player_id, p.current_name as name, p.game_uid, p.server_id,
           case p_metric when 'power' then p.power else p.kills end as value,
           coalesce(p.roster_observed_at, p.last_seen_at, p.updated_at) as captured_at,
           'roster'::text as source
    from public.players p
    join public.player_current_alliance() c on c.player_id = p.player_id
    where (case p_metric when 'power' then p.power when 'kills' then p.kills end) is not null
  ),
  -- The Migration tab's state lists (0301): each server's own top 150, read per subject
  -- server rather than per collecting server, so a server we never collect from still
  -- has its strongest players on the ranking, as fresh as its list was last read. Power
  -- only; the kills ranking has no such list.
  lists as (
    select s.observation_id, min(s.server_id) as server_id, max(s.captured_at) as at
    from public.player_snapshots s
    where p_metric = 'power'
      and s.source_command = 'cross.server.rank'
      and s.captured_at > now() - interval '30 days'
    group by s.observation_id
    having min(s.server_id) = max(s.server_id)
  ),
  newest_list as (
    select distinct on (server_id) server_id, observation_id
    from lists
    order by server_id, at desc
  ),
  listed as (
    select s.snapshot_id as id, s.player_id, s.name, s.game_uid, s.server_id,
           s.power as value, s.captured_at, 'board'::text as source
    from newest_list n
    join public.player_snapshots s
      on s.observation_id = n.observation_id and s.server_id = n.server_id
     and s.source_command = 'cross.server.rank'
  ),
  merged as (
    select distinct on (u.game_uid) u.*
    from (select * from board union all select * from roster union all select * from listed) u
    order by u.game_uid, u.captured_at desc, (u.source <> 'board')
  )
  select m.id, m.player_id,
         (row_number() over (order by m.value desc nulls last, m.game_uid))::integer,
         m.name, m.game_uid, m.server_id, m.value, m.captured_at, m.source
  from merged m
$$;

