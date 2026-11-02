-- 0300: who moved servers, read off the state lists, and how fresh each list is.
--
-- Every entry of a state list (`cross.server.rank`, or `server.rank` for our own server)
-- names the server the player is on NOW (`serverId`), and the game ends every uid in the
-- six digits of the server the account was made on. Until the migration window opened
-- the two agreed for every one of the 3,300 players on the lists of 2026-10-27; a
-- player whose uid says 571 and who stands on server 580's list has moved there. So the
-- movers are the entries where the two differ, and each list that is read again after
-- the window opened shows the people who arrived on that server.
--
-- It sees only arrivals on the servers whose list was read after the move, and only the
-- top 150 of each, so `migration_list_freshness` says which lists are in and when they
-- were read. A mover who is not strong enough for a list is not here.
--
-- A player who moved long ago would also differ; none did on 2026-10-27, so everything
-- listed is from this window.
--
-- Place is counted on the merged board of servers 567-588 as in 0292: one past the
-- listed players who are stronger. Alliance comes through the gated `migration_list_alliance`
-- (0292), so it is empty for those who cannot manage migrations.

create function public.migration_movers(
  p_from_server int default 565,
  p_to_server int default 588,
  p_board_from int default 567,
  p_board_to int default 588
)
returns table (
  game_uid bigint,
  name text,
  home_server int,
  server_id int,
  alliance_name text,
  power bigint,
  board_rank bigint,
  captured_at timestamptz
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
       and s.captured_at > now() - interval '30 days'
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
  )
  select l.game_uid, l.name, (l.game_uid % 1000000)::int, l.server_id,
         public.migration_list_alliance(l.player_id, l.observation_id),
         l.power,
         (select count(*) + 1 from board b where b.power > l.power),
         l.captured_at
    from listed l
   where (l.game_uid % 1000000) <> l.server_id
   order by l.power desc nulls last, l.game_uid;
$$;

create function public.migration_list_freshness(
  p_from_server int default 565,
  p_to_server int default 588
)
returns table (
  server_id int,
  captured_at timestamptz,
  listed bigint,
  movers bigint
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
       and s.captured_at > now() - interval '30 days'
     group by s.observation_id
    having min(s.server_id) = max(s.server_id)
  ),
  newest as (
    select distinct on (server_id) server_id, observation_id, at
      from lists
     order by server_id, at desc
  )
  select g.server_id, n.at, count(s.snapshot_id),
         count(s.snapshot_id) filter (where (s.game_uid % 1000000) <> g.server_id)
    from generate_series(p_from_server, p_to_server) as g(server_id)
    left join newest n on n.server_id = g.server_id
    left join public.player_snapshots s
           on s.observation_id = n.observation_id and s.server_id = g.server_id
          and s.source_command in ('cross.server.rank', 'server.rank')
   group by g.server_id, n.at
   order by g.server_id;
$$;

revoke all on function public.migration_movers(int, int, int, int) from public, anon, authenticated;
revoke all on function public.migration_list_freshness(int, int) from public, anon, authenticated;
grant execute on function public.migration_movers(int, int, int, int) to authenticated, service_role;
grant execute on function public.migration_list_freshness(int, int) to authenticated, service_role;

comment on function public.migration_movers(int, int, int, int) is
  'Players on a state list whose current server differs from the one their uid ends in: '
  'the people who moved (0300). Arrivals on lists read since the window opened.';
comment on function public.migration_list_freshness(int, int) is
  'Per server: when its newest state list was read, how many players it holds and how many '
  'of them moved (0300). A server with no list has a null time.';
