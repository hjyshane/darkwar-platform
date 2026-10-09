-- 0267: the Player Ranking's alliance is the CURRENT one, and the roster source is
-- current members.
--
-- 0263/0265 took a player's alliance from players.current_alliance_id, a LAST KNOWN
-- value that leaving never clears. On production 1,760 of the 12,828 players that
-- name an alliance are in it no longer (0266 fixed the same fault on the map).
--
-- THE SIGNAL. players.roster_observed_at is the captured_at of the newest roster
-- snapshot that listed the player (0030), and current_alliance_id is the alliance
-- of that snapshot. So within an alliance, whoever the newest roster capture
-- listed carries the alliance's newest roster_observed_at, and someone who left
-- since carries an older one. No snapshot walk is needed - the 0150 view that is
-- slow per alliance is not touched - just a group-by over `players`.
--
-- WHEN IT IS TRUSTED. Only if the newest capture lists nearly everybody: at least
-- 95% of the game's member count (alliances.member_count; no count = trusted).
-- A half-scrolled capture lists some members and would otherwise send the rest
-- away (0067). Where the newest capture is not trusted, or the player was never
-- read from a roster, the last known alliance stands - nothing says they left.
-- Same rule, same 95%, as map_atlas in 0266.
--
-- WHAT CHANGES
--   * player_current_alliance()  (player_id, alliance_id) for players whose
--     alliance is current under the rule above.
--   * player_ranking_merged      the roster source is those players, so someone
--     who left no longer enters the ranking through an old alliance. A player on
--     the in-game board stays on it, with no alliance.
--   * player_ranking_page        alliance_id / code / name (and the search and
--     sort on them) come from the same function.
--
-- Signatures and return types are unchanged, so create-or-replace keeps grants.

create or replace function public.player_current_alliance()
returns table (player_id uuid, alliance_id uuid)
language sql
stable
set search_path = ''
as $$
  with clock as (
    select p.current_alliance_id as alliance_id, max(p.roster_observed_at) as newest
      from public.players p
     where p.current_alliance_id is not null and p.roster_observed_at is not null
     group by p.current_alliance_id
  ),
  fresh as (
    select c.alliance_id, c.newest, count(*) as n
      from clock c
      join public.players p
        on p.current_alliance_id = c.alliance_id and p.roster_observed_at = c.newest
     group by c.alliance_id, c.newest
  ),
  verdict as (
    select f.alliance_id, f.newest
      from fresh f
      join public.alliances a on a.alliance_id = f.alliance_id
     where f.n >= floor(coalesce(a.member_count, 0) * 0.95)
  )
  select p.player_id, p.current_alliance_id
    from public.players p
    left join verdict v on v.alliance_id = p.current_alliance_id
   where p.current_alliance_id is not null
     and (v.alliance_id is null
          or p.roster_observed_at is null
          or p.roster_observed_at >= v.newest)
$$;

comment on function public.player_current_alliance() is
  'Players whose alliance is current: in the newest roster capture of a trusted alliance (>= 95% of its member count), or in an alliance with no trusted capture (last known stands). 0267.';

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

create or replace function public.player_ranking_page(
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
    select '%' || replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_search, '')) = '' as blank
  )
  select m.id, m.player_id, m.rank, m.name, m.game_uid, m.server_id, m.value,
         m.captured_at, m.source, count(*) over (),
         a.alliance_id, a.current_code, a.current_name
  from public.player_ranking_merged(p_metric) m
  left join public.player_current_alliance() c on c.player_id = m.player_id
  left join public.alliances a on a.alliance_id = c.alliance_id
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
  'server unioned with CURRENT alliance members, ranked over the whole set, then filtered by '
  'server/search (name, uid, server, alliance name or tag), sorted and sliced. `total` is the '
  'filtered count. Alliance is the current one (player_current_alliance, 0267). Limit is capped at 200.';

revoke execute on function public.player_current_alliance() from public, anon;
grant execute on function public.player_current_alliance() to authenticated, service_role;
