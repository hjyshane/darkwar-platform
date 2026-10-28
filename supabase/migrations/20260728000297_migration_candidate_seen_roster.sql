-- 0297: a candidate is also known from an alliance roster we opened.
--
-- The Cross-Server player ranking lists, besides the newest in-game board per server, every
-- player placed in an alliance whose roster we captured (`player_ranking_merged`, 0263/0267):
-- name, server and power come off the `players` row, not from a snapshot. 0296 looked at
-- snapshots only, so a candidate who is on that ranking through a roster, and on no
-- state list, came back blank.
--
-- Same signature and columns as 0296. Per player the newer of the two sightings wins:
-- the latest snapshot of any kind, or the roster row (`source_command` says 'roster').
-- The alliance is the roster's current one (`player_current_alliance`, 0267) when that is
-- where the sighting came from; for a snapshot it is the name in the snapshot, gated to
-- those who manage migrations, falling back to the roster's.

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
           a.current_name as alliance_name
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
