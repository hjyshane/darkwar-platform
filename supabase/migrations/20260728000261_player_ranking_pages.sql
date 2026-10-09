-- 0261: Player Ranking is answered in the database, one page at a time.
--
-- The screen used to download every row it could draw: up to 5,000 board
-- snapshots, plus `alliance_roster_latest` unfiltered. 0150 measured that view
-- at 0.3 s per alliance and warned that an unfiltered read is a lateral over
-- every alliance; with a new server's alliances added it is the slow part of
-- the page, and past the statement timeout it is an error rather than a slow
-- page. The browser then merged, sorted and sliced to 50.
--
-- player_ranking_merged(metric)    the whole ranking, ranked
-- player_ranking_page(...)         one filtered/sorted/searched page + total
-- player_ranking_servers(metric)   per-server counts, for the filter chips
--
-- WHERE A ROW COMES FROM. 'board' is the newest in-game ranking capture per
-- COLLECTING server (server.rank / kill.rank): a scan of a new server writes a
-- second board and must not evict the first, which "the newest batch overall"
-- did. 'roster' is every player the scans have placed in an alliance, from
-- `players` (one indexed row per person, already holding the latest power and
-- kills) rather than from the roster view's per-alliance snapshot walk.
--
-- ONE DIFFERENCE FROM THE VIEW, deliberately accepted: `players.
-- current_alliance_id` is a LAST KNOWN alliance (CLAUDE.md), so somebody who
-- has since left an alliance is still ranked by their last figures. For a
-- ranking of players that is the right failure - they exist, and the figure is
-- the latest we saw - where for an alliance's member COUNT it would be wrong.
--
-- A player on both sources appears once, from whichever reading is newer; the
-- board wins a tie. Ranks are numbered over the whole merged set BEFORE any
-- filter, so a server chip narrows the list without renumbering it.
--
-- SECURITY INVOKER throughout: the caller's own RLS applies to the tables
-- read. Execute is revoked from public AND anon explicitly (hosted Supabase
-- grants new functions to anon regardless of `from public`).

-- Newest-board-per-collector is one index descent per server.
create index if not exists player_snapshots_command_from_captured_idx
  on public.player_snapshots (source_command, collected_from_server_id, captured_at desc);

create function public.player_ranking_merged(p_metric text)
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
    where p.current_alliance_id is not null
      and (case p_metric when 'power' then p.power when 'kills' then p.kills end) is not null
  ),
  merged as (
    select distinct on (u.game_uid) u.*
    from (select * from board union all select * from roster) u
    order by u.game_uid, u.captured_at desc, (u.source <> 'board')
  )
  select m.id, m.player_id,
         (row_number() over (order by m.value desc nulls last, m.game_uid))::integer,
         m.name, m.game_uid, m.server_id, m.value, m.captured_at, m.source
  from merged m
$$;

create function public.player_ranking_page(
  p_metric text,
  p_server integer default null,
  p_search text default null,
  p_sort text default 'rank',
  p_desc boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  player_id uuid,
  rank integer,
  name text,
  game_uid bigint,
  server_id integer,
  value bigint,
  captured_at timestamptz,
  source text,
  total bigint
)
language sql
stable
set search_path = ''
as $$
  with q as (
    -- LIKE metacharacters in the search box mean themselves.
    select '%' || replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_search, '')) = '' as blank
  )
  select m.id, m.player_id, m.rank, m.name, m.game_uid, m.server_id, m.value,
         m.captured_at, m.source, count(*) over ()
  from public.player_ranking_merged(p_metric) m
  cross join q
  where (p_server is null or m.server_id = p_server)
    and (q.blank
         or m.name ilike q.pat
         or m.game_uid::text like q.pat
         or m.server_id::text like q.pat)
  order by
    case when p_sort = 'name' and not p_desc then m.name end asc nulls last,
    case when p_sort = 'name' and p_desc then m.name end desc nulls last,
    case when not p_desc then
      case p_sort when 'value' then m.value when 'server_id' then m.server_id::bigint
                  when 'game_uid' then m.game_uid else m.rank::bigint end
    end asc nulls last,
    case when p_desc then
      case p_sort when 'value' then m.value when 'server_id' then m.server_id::bigint
                  when 'game_uid' then m.game_uid else m.rank::bigint end
    end desc nulls last,
    m.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create function public.player_ranking_servers(p_metric text)
returns table (server_id integer, players bigint, newest timestamptz)
language sql
stable
set search_path = ''
as $$
  select m.server_id, count(*), max(m.captured_at)
  from public.player_ranking_merged(p_metric) m
  group by m.server_id
  order by m.server_id
$$;

comment on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) is
  'One page of the Player Ranking (metric power|kills): newest in-game board per collecting '
  'server unioned with players placed in an alliance, ranked over the whole set, then filtered '
  'by server/search, sorted and sliced. `total` is the filtered count. Limit is capped at 200.';

revoke execute on function public.player_ranking_merged(text) from public, anon;
revoke execute on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) from public, anon;
revoke execute on function public.player_ranking_servers(text) from public, anon;
grant execute on function public.player_ranking_merged(text) to authenticated, service_role;
grant execute on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.player_ranking_servers(text) to authenticated, service_role;
