-- 0265: Player Ranking shows each player's alliance.
--
-- player_ranking_page gains alliance_id / alliance_code / alliance_name, and the
-- search box also matches an alliance's name or tag. The return type changes, so
-- the function is dropped and recreated (CREATE OR REPLACE cannot do it).
--
-- WHICH ALLIANCE. `players.current_alliance_id` is a LAST KNOWN alliance
-- (CLAUDE.md): somebody who has since left still names the one they left. 0263
-- already ranks by that column's population on purpose, and the roster view that
-- would tell the truth is the slow read 0263 was written to avoid. So a player
-- who left and was never seen elsewhere shows their old alliance here. For a
-- list of PEOPLE that is the lesser failure; it is not safe for a member COUNT.
--
-- Board rows with no matched player row (player_id null) show no alliance.

drop function public.player_ranking_page(text, integer, text, text, boolean, integer, integer);

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
  total bigint,
  alliance_id uuid,
  alliance_code text,
  alliance_name text
)
language sql
stable
set search_path = ''
as $$
  with q as (
    -- LIKE metacharacters in the search box mean themselves.
    select '%' || replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_search, '')) = '' as blank
  )
  select m.id, m.player_id, m.rank, m.name, m.game_uid, m.server_id, m.value,
         m.captured_at, m.source, count(*) over (),
         a.alliance_id, a.current_code, a.current_name
  from public.player_ranking_merged(p_metric) m
  left join public.players p on p.player_id = m.player_id
  left join public.alliances a on a.alliance_id = p.current_alliance_id
  cross join q
  where (p_server is null or m.server_id = p_server)
    and (q.blank
         or m.name ilike q.pat
         or m.game_uid::text like q.pat
         or m.server_id::text like q.pat
         or a.current_name ilike q.pat
         or a.current_code ilike q.pat)
  order by
    case when p_sort = 'name' and not p_desc then m.name end asc nulls last,
    case when p_sort = 'name' and p_desc then m.name end desc nulls last,
    case when p_sort = 'alliance' and not p_desc then coalesce(a.current_code, a.current_name) end asc nulls last,
    case when p_sort = 'alliance' and p_desc then coalesce(a.current_code, a.current_name) end desc nulls last,
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

comment on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) is
  'One page of the Player Ranking (metric power|kills): newest in-game board per collecting '
  'server unioned with players placed in an alliance, ranked over the whole set, then filtered '
  'by server/search (name, uid, server, alliance name or tag), sorted and sliced. `total` is the '
  'filtered count. Alliance is the players row''s LAST KNOWN alliance. Limit is capped at 200.';

-- A dropped function takes its grants with it; hosted Supabase also re-grants a
-- new function to anon regardless of `from public`.
revoke execute on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.player_ranking_page(text, integer, text, text, boolean, integer, integer) to authenticated, service_role;
