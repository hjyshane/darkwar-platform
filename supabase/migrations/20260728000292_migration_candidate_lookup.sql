-- 0292: where a player stands on the migration board, for the tier.
--
-- The Migration tab's state list (`cross.server.rank`, or `server.rank` for our own
-- server; both land in player_snapshots) gives each server's 150 strongest players. The game cuts
-- the migration tiers on the place across ALL the servers of the migration range
-- (567-588) taken together, by power: 1-10 commander, 11-46 elite, 47-226 advanced,
-- beyond that backbone. No single capture holds that board, so it is assembled here:
-- the newest list per server, merged, ranked by power.
--
-- The place is therefore only as good as the lists behind it: a server whose list
-- is missing or old shifts everyone below its players. `migration_board_info`
-- reports which servers are in, and how old, so the screen can say so.
--
-- A candidate not in any list is beyond their own server's 150th. They are
-- `backbone` for certain only if even the strongest such player would be past 226:
-- `rank_floor_unlisted` is that bound.
--
-- Read as the caller, and from typed columns only: clients cannot read `raw` (0016).
--
-- Migrate power is joined from the component history, whose view already withholds
-- it from everybody but admins (0086); for anyone else it comes back null.

-- The alliance a state list names beside a player lives only in `raw`, which clients
-- cannot read (0016). This hands back that one text, to those who manage migrations.
create function public.migration_list_alliance(p_player uuid, p_observation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.raw ->> 'allianceName'
    from public.player_snapshots s
   where (select public.has_permission('migration.manage'))
     and s.player_id = p_player
     and s.observation_id = p_observation
   limit 1;
$$;

revoke all on function public.migration_list_alliance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.migration_list_alliance(uuid, uuid) to authenticated, service_role;

create function public.migration_candidate_lookup(
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
  overall_rank bigint,
  captured_at timestamptz,
  migrate_power bigint,
  migrate_power_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lists as (
    -- A state list is one observation whose 150 players are all of one server. Other
    -- servers answer to `cross.server.rank`; our own comes as `server.rank`, which
    -- used to be a mixed board across the group, so only a single-server one counts.
    -- Filtered by server first, on the (server_id, captured_at) index: a mixed board
    -- still has several of the group's servers in range, so it is still told apart.
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
    select s.player_id, s.observation_id, s.game_uid, s.name, s.server_id, s.power, s.captured_at,
           rank() over (order by s.power desc nulls last) as overall_rank
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
  )
  select b.game_uid, b.name, b.server_id, public.migration_list_alliance(b.player_id, b.observation_id),
         b.power, b.overall_rank, b.captured_at, m.power, m.captured_at
    from board b
    left join lateral (
      select h.power, h.captured_at
        from public.player_component_power_history h
       where h.player_id = b.player_id and h.metric = 'migrate_power'
       order by h.captured_at desc
       limit 1
    ) m on true
   where b.game_uid = any (p_uids)
      or lower(btrim(b.name)) in (select lower(btrim(n)) from unnest(p_names) as n)
   order by b.overall_rank;
$$;

create function public.migration_board_info(
  p_from_server int default 567,
  p_to_server int default 588
)
returns table (
  servers int[],
  missing_servers int[],
  listed bigint,
  oldest_at timestamptz,
  newest_at timestamptz,
  rank_floor_unlisted bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lists as (
    -- A state list is one observation whose 150 players are all of one server. Other
    -- servers answer to `cross.server.rank`; our own comes as `server.rank`, which
    -- used to be a mixed board across the group, so only a single-server one counts.
    -- Filtered by server first, on the (server_id, captured_at) index: a mixed board
    -- still has several of the group's servers in range, so it is still told apart.
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
    select s.server_id, s.power, s.captured_at
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
  ),
  per_server as (
    select server_id, min(power) as last_power, max(captured_at) as at
      from board group by server_id
  )
  select coalesce((select array_agg(server_id order by server_id) from per_server), '{}'),
         coalesce((select array_agg(g order by g)
                     from generate_series(p_from_server, p_to_server) as g
                    where g not in (select server_id from per_server)), '{}'),
         (select count(*) from board),
         (select min(at) from per_server),
         (select max(at) from per_server),
         -- Somebody beyond their server's 150th has no more power than the best
         -- such server's 150th, so their place is at least one past everyone above it.
         (select count(*) + 1 from board
           where power > (select max(last_power) from per_server));
$$;

revoke all on function public.migration_candidate_lookup(text[], bigint[], int, int)
  from public, anon, authenticated;
revoke all on function public.migration_board_info(int, int)
  from public, anon, authenticated;
grant execute on function public.migration_candidate_lookup(text[], bigint[], int, int)
  to authenticated, service_role;
grant execute on function public.migration_board_info(int, int)
  to authenticated, service_role;

comment on function public.migration_candidate_lookup(text[], bigint[], int, int) is
  'Players by name or uid with their place on the merged board of the newest '
  'cross.server.rank list per server (0292). migrate_power is null unless the '
  'caller is an admin.';
comment on function public.migration_board_info(int, int) is
  'Which servers the merged migration board is built from, how old they are, and the '
  'lowest place a player outside every list could hold (0292).';
