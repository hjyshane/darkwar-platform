-- 0294: the merged migration board itself, top places only, for the Tiers view.
--
-- Same board as `migration_candidate_lookup` (0292) - the newest state list per server
-- of 567-588 merged and ranked by power - but returned whole up to the last tier
-- boundary (226). The lists hold each server's top 150, and the weakest of those
-- still ranks past 2,000 overall, so places 1-226 are complete whenever every server's
-- list is in; `migration_board_info` says whether they are.
--
-- Read as the caller from typed columns; the alliance name comes through the gated
-- `migration_list_alliance` (0292), so it is empty for anyone who cannot manage migrations.

create function public.migration_tier_board(
  p_limit int default 226,
  p_from_server int default 567,
  p_to_server int default 588
)
returns table (
  overall_rank bigint,
  game_uid bigint,
  name text,
  server_id int,
  alliance_name text,
  power bigint,
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
  board as (
    select s.player_id, s.observation_id, s.game_uid, s.name, s.server_id, s.power,
           s.captured_at,
           rank() over (order by s.power desc nulls last) as overall_rank
      from public.player_snapshots s
      join newest n on n.observation_id = s.observation_id and n.server_id = s.server_id
  )
  select b.overall_rank, b.game_uid, b.name, b.server_id,
         public.migration_list_alliance(b.player_id, b.observation_id),
         b.power, b.captured_at
    from board b
   where b.overall_rank <= p_limit
   order by b.overall_rank, b.game_uid;
$$;

revoke all on function public.migration_tier_board(int, int, int) from public, anon, authenticated;
grant execute on function public.migration_tier_board(int, int, int) to authenticated, service_role;

comment on function public.migration_tier_board(int, int, int) is
  'Places 1..p_limit of the merged state-list board across the migration servers (0294).';
