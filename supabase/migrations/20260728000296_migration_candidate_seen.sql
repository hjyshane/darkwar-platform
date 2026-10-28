-- 0296: what we know of a candidate who is not on any state list.
--
-- The state lists (0292) hold each server's top 150, and most people being considered
-- for a move are weaker than that, so for them the lookup found nothing. They are often
-- known from somewhere else, though: a profile that was opened (get.user.info.multi), a
-- board, a roster. This returns the newest snapshot of any kind for each player matched
-- by uid or name: name, server, power, alliance and migrate power as last seen.
--
-- There is no place on the merged board for them, since they are not in it, so the place
-- is ESTIMATED from the power seen: one past the listed players who were stronger. That is
-- as good as the power is fresh, and `captured_at` says how fresh. A listed player's exact
-- place stays with `migration_candidate_lookup`.
--
-- Read as the caller from typed columns. The alliance name comes through the gated
-- `migration_list_alliance` (0292), so it is empty for anyone who cannot manage
-- migrations. The board is assembled as in 0292 and 0294.

create function public.migration_candidate_seen(
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
  latest as (
    select distinct on (s.player_id)
           s.player_id, s.observation_id, s.game_uid, s.name, s.server_id, s.power,
           s.captured_at, s.source_command
      from public.player_snapshots s
      join matched m on m.player_id = s.player_id
     where s.power is not null
     order by s.player_id, s.captured_at desc
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
         public.migration_list_alliance(l.player_id, l.observation_id),
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

revoke all on function public.migration_candidate_seen(text[], bigint[], int, int)
  from public, anon, authenticated;
grant execute on function public.migration_candidate_seen(text[], bigint[], int, int)
  to authenticated, service_role;

comment on function public.migration_candidate_seen(text[], bigint[], int, int) is
  'Newest snapshot of any kind per player matched by uid or name, with the place on the '
  'merged state-list board ESTIMATED from the power seen (0296).';
