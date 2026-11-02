-- 0303: movers are also read from the alliance rosters.
--
-- (0300 read them off the state lists only; this replaces `migration_movers`, whose result
-- gains a `source` column and whose arguments gain `p_since`, so it is dropped and created.)
--
-- Every entry of a state list (`cross.server.rank`, or `server.rank` for our own server)
-- names the server the player is on NOW (`serverId`), and so does every member of an
-- alliance roster (`al.rank`: `serverId` and `curServerId`, equal in every row captured).
-- The game ends every uid in the six digits of the server the account was made on. Until the
-- migration window opened the two agreed for every player read (3,300 on the lists of
-- 2026-10-27, 12,555 roster rows before 2026-11-02); a player whose uid says 571 and who is
-- on server 580 has moved there. So the movers are the players where they differ.
--
-- Two sources, because the lists hold only each server's top 150 and the rosters hold every
-- member of every alliance whose member list was opened: the newest sighting of each mover
-- from either wins. A server whose list was not read since the window opened shows no
-- arrivals from the list, but its alliances' rosters still can; `migration_list_freshness`
-- says which lists are in and when they were read.
--
-- A mover read as back on their home server later is still listed from the earlier
-- sighting: only moves are looked for, not returns. A player who moved long ago would also
-- differ; none did before the window, so everything listed is from this one.
--
-- Place is counted on the merged board of servers 567-588 as in 0292: one past the listed
-- players who are stronger (so a roster-only mover, who is not on a list, is placed by their
-- power). Alliance for a list sighting comes through the gated `migration_list_alliance`
-- (0292); for a roster sighting it is the roster's alliance.

drop function public.migration_movers(int, int, int, int);

create function public.migration_movers(
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
           m.game_uid, m.name, m.server_id, a.current_name as alliance_name,
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

revoke all on function public.migration_movers(int, int, int, int, interval) from public, anon, authenticated;
grant execute on function public.migration_movers(int, int, int, int, interval) to authenticated, service_role;

comment on function public.migration_movers(int, int, int, int, interval) is
  'Players on a state list or in an alliance roster whose current server differs from the one '
  'their uid ends in: the people who moved (0303). The newest sighting of each, with its source.';
