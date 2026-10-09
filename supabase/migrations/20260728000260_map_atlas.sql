-- 0260: one server's bases and the alliances they belong to, in one call, for the map.
--
-- The map draws every swept base of a server coloured by alliance, with a ranking
-- of the alliances beside it. That is thousands of rows (2,440 tiles from one pass
-- over 581), and PostgREST answers at most 1,000 rows however large a limit is
-- asked, so a row-per-base query would silently drop whole alliances. A function
-- that returns ONE jsonb value is one row to PostgREST and is not cut.
--
-- Shape, kept compact because it is sent whole:
--   alliances: [{id, code, name, bases, power}], most bases first
--   bases:     [[game_uid, x, y, hq_level, power, alliance_index, seen_epoch_seconds, name]]
--              alliance_index points into `alliances`, or -1 for none known.
--
-- THE ALLIANCE IS THE LAST ONE WE KNEW, not necessarily the current one:
-- players.current_alliance_id is set when a player is seen in an alliance and never
-- cleared (CLAUDE.md, "Membership"). That is right for colouring a map of where
-- people were last seen, and wrong for any count of who is IN an alliance today -
-- which is why the counts here are called `bases` and the panel says "seen".
--
-- SECURITY INVOKER: the members-only policies on the tables underneath apply to
-- whoever calls it.

create function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at,
           p.power, p.current_alliance_id as alliance_id
      from public.latest_world_cities w
      left join public.players p on p.player_id = w.player_id
     where w.server_id = p_server_id
  ),
  a as (
    select al.alliance_id, al.current_code, al.current_name,
           count(*) as bases,
           coalesce(sum(b.power), 0) as power,
           row_number() over (order by count(*) desc, al.current_code) - 1 as ord
      from b
      join public.alliances al on al.alliance_id = b.alliance_id
     group by al.alliance_id, al.current_code, al.current_name
  )
  select jsonb_build_object(
    'alliances', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.alliance_id, 'code', a.current_code, 'name', a.current_name,
               'bases', a.bases, 'power', a.power) order by a.ord)
        from a), '[]'::jsonb),
    'bases', coalesce((
      select jsonb_agg(jsonb_build_array(
               b.game_uid, b.x, b.y, b.hq_level, b.power, coalesce(a.ord, -1),
               extract(epoch from b.captured_at)::bigint, b.name))
        from b left join a on a.alliance_id = b.alliance_id), '[]'::jsonb)
  );
$$;

revoke all on function public.map_atlas(int) from public, anon;
grant execute on function public.map_atlas(int) to authenticated, service_role;

comment on function public.map_atlas(int) is
  'A server''s swept bases with the alliance each was last seen in, plus the alliance ranking, as one jsonb (0260).';
