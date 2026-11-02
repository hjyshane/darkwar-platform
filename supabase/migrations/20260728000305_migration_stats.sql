-- 0305: the migration boards by server and by alliance, without a baseline event.
--
-- Three reads over what the collector already has, all on the merged board of servers
-- 567-588 (the game cuts the tiers there: 1-10 commander, 11-46 elite, 47-226 advanced):
--
--   migration_server_top    one server's newest state list, as the game's own tab shows it
--   migration_server_stats  per server: when its list was read, who is on it by tier, how
--                           many moved in and out
--   migration_alliance_stats per alliance whose member list was opened: members, power,
--                           how many of them moved, and by tier
--
-- Movers are the players on a server other than the one their uid ends in (0300, 0303).
-- A tier of a roster member is judged by power against the board's own cut-offs - the power
-- of the 10th, 46th and 226th - since a roster member is not on a list with a place.
-- Alliance names on a list come through the gated `migration_list_alliance` (0292).

create function public.migration_server_top(
  p_server int,
  p_limit int default 150,
  p_board_from int default 567,
  p_board_to int default 588
)
returns table (
  server_place bigint,
  game_uid bigint,
  name text,
  home_server int,
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
       and s.server_id between least(p_board_from, p_server) and greatest(p_board_to, p_server)
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
  select (row_number() over (order by l.power desc nulls last, l.game_uid))::bigint,
         l.game_uid, l.name, (l.game_uid % 1000000)::int,
         public.migration_list_alliance(l.player_id, l.observation_id),
         l.power,
         (select count(*) + 1 from board b where b.power > l.power),
         l.captured_at
    from listed l
   where l.server_id = p_server
   order by 1
   limit greatest(p_limit, 1);
$$;

create function public.migration_server_stats(
  p_from_server int default 565,
  p_to_server int default 588,
  p_board_from int default 567,
  p_board_to int default 588
)
returns table (
  server_id int,
  captured_at timestamptz,
  listed bigint,
  min_power bigint,
  max_power bigint,
  total_power bigint,
  commanders bigint,
  elites bigint,
  advanced bigint,
  moved_in bigint,
  moved_out bigint
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
       and s.server_id between least(p_board_from, p_from_server) and greatest(p_board_to, p_to_server)
       and s.captured_at > now() - interval '30 days'
     group by s.observation_id
    having min(s.server_id) = max(s.server_id)
  ),
  newest as (
    select distinct on (server_id) server_id, observation_id, at
      from lists
     order by server_id, at desc
  ),
  listed as (
    select s.server_id, s.power
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
     where s.source_command in ('cross.server.rank', 'server.rank')
  ),
  placed as (
    select l.server_id, l.power,
           case when l.server_id between p_board_from and p_board_to
                then rank() over (partition by (l.server_id between p_board_from and p_board_to)
                                  order by l.power desc nulls last) end as place
      from listed l
  ),
  moves as (
    select m.server_id as arrived_on, m.home_server as left_from
      from public.migration_movers(p_from_server, p_to_server, p_board_from, p_board_to) m
  )
  select g.server_id, n.at, count(p.power), min(p.power), max(p.power), sum(p.power),
         count(*) filter (where p.place <= 10),
         count(*) filter (where p.place between 11 and 46),
         count(*) filter (where p.place between 47 and 226),
         (select count(*) from moves v where v.arrived_on = g.server_id),
         (select count(*) from moves v where v.left_from = g.server_id)
    from generate_series(p_from_server, p_to_server) as g(server_id)
    left join newest n on n.server_id = g.server_id
    left join placed p on p.server_id = g.server_id
   group by g.server_id, n.at
   order by g.server_id;
$$;

create function public.migration_alliance_stats(
  p_limit int default 300,
  p_from_server int default 565,
  p_to_server int default 588,
  p_board_from int default 567,
  p_board_to int default 588
)
returns table (
  alliance_id uuid,
  name text,
  code text,
  server_id int,
  members bigint,
  total_power bigint,
  moved bigint,
  commanders bigint,
  elites bigint,
  advanced bigint,
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
       and s.server_id between p_board_from and p_board_to
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
     where s.source_command in ('cross.server.rank', 'server.rank')
  ),
  cutoffs as (
    select (select power from board order by power desc nulls last offset 9 limit 1) as c10,
           (select power from board order by power desc nulls last offset 45 limit 1) as c46,
           (select power from board order by power desc nulls last offset 225 limit 1) as c226
  ),
  roster as (
    select a.alliance_id, a.current_name, a.current_code, a.server_id as alliance_server,
           m.game_uid, m.server_id as member_server, m.power, m.captured_at
      from public.alliances a
      cross join lateral (
        select max(x.captured_at) as at
          from public.alliance_member_snapshots x
         where x.alliance_id = a.alliance_id and x.captured_at > now() - interval '30 days'
      ) n
      join public.alliance_member_snapshots m
        on m.alliance_id = a.alliance_id and m.captured_at = n.at
     where a.server_id between p_from_server and p_to_server
  )
  select r.alliance_id, r.current_name, r.current_code, r.alliance_server,
         count(*), sum(r.power),
         count(*) filter (where (r.game_uid % 1000000) <> r.member_server),
         count(*) filter (where r.power >= c.c10),
         count(*) filter (where r.power >= c.c46 and r.power < c.c10),
         count(*) filter (where r.power >= c.c226 and r.power < c.c46),
         max(r.captured_at)
    from roster r
   cross join cutoffs c
   group by r.alliance_id, r.current_name, r.current_code, r.alliance_server
   order by count(*) filter (where (r.game_uid % 1000000) <> r.member_server) desc,
            sum(r.power) desc nulls last
   limit greatest(p_limit, 1);
$$;

revoke all on function public.migration_server_top(int, int, int, int) from public, anon, authenticated;
revoke all on function public.migration_server_stats(int, int, int, int) from public, anon, authenticated;
revoke all on function public.migration_alliance_stats(int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.migration_server_top(int, int, int, int) to authenticated, service_role;
grant execute on function public.migration_server_stats(int, int, int, int) to authenticated, service_role;
grant execute on function public.migration_alliance_stats(int, int, int, int, int) to authenticated, service_role;

comment on function public.migration_server_top(int, int, int, int) is
  'One server''s newest state list as the game shows it, with each player''s place on the merged board (0305).';
comment on function public.migration_server_stats(int, int, int, int) is
  'Per server: when its list was read, who is on it by tier, and how many moved in and out (0305).';
comment on function public.migration_alliance_stats(int, int, int, int, int) is
  'Per alliance whose member list was opened: members, power, movers and tier counts by power (0305).';
