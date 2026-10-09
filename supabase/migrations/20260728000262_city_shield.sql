-- 0262: when a base's shield ends, so the map can tell who is shielded.
--
-- The city tile carries it (field 11 of the city message, decoded since the map
-- was first read and never stored): epoch SECONDS, in the past once the shield
-- is down, absent when the base was never shielded. In a day of captures 144 of
-- 8,345 tiles were in the future, 2 to 2.5 hours ahead - shielded right now.
--
-- It is the state AT THE SIGHTING. A base last seen three days ago with an
-- expired shield may be shielded now; the map says how old each sighting is
-- instead of pretending otherwise.
--
-- Adding a nullable column to a table this size is a catalogue change only; old
-- rows stay null until the base is seen again.

alter table public.world_city_snapshots
  add column shield_end_at timestamptz;

comment on column public.world_city_snapshots.shield_end_at is
  'When the base''s shield ends, as of this sighting (0262). In the past once down; null when never shielded or not read.';

-- Same body as 0144 with the new column appended, which create or replace allows
-- and which keeps the grant.
create or replace view public.latest_world_cities
with (security_invoker = true) as
select distinct on (w.server_id, w.game_uid)
  w.server_id,
  w.game_uid,
  w.player_id,
  w.name,
  w.x,
  w.y,
  w.point_id,
  w.hq_level,
  w.captured_at,
  w.shield_end_at
from public.world_city_snapshots w
order by w.server_id, w.game_uid, w.captured_at desc;

-- The atlas (0260) with the shield appended to each base: [..., name, shield_end_epoch].
-- The shape is otherwise unchanged, so a client that ignores the ninth element keeps working.
create or replace function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at, w.shield_end_at,
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
               extract(epoch from b.captured_at)::bigint, b.name,
               extract(epoch from b.shield_end_at)::bigint))
        from b left join a on a.alliance_id = b.alliance_id), '[]'::jsonb)
  );
$$;

comment on function public.map_atlas(int) is
  'A server''s swept bases with the alliance each was last seen in, plus the alliance ranking, as one jsonb (0260; shield end appended 0262).';
