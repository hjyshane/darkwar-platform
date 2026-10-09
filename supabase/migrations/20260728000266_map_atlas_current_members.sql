-- 0266: the map counts an alliance's CURRENT members, not everyone who ever named it.
--
-- map_atlas (0260/0262) took each base's alliance from players.current_alliance_id.
-- That column is a LAST KNOWN alliance: joining sets it, leaving never clears it
-- (CLAUDE.md, "Membership"). So every player who has since left still showed as a
-- member, and the alliance ranking beside the map inflated: measured on production
-- for server 580, ES_1 listed 155 players against a roster of 100, GNSQ 108 against
-- 63, LovE 78 against 63.
--
-- THE RULE. A base belongs to its last known alliance only when that alliance's
-- newest roster capture (alliance_roster_latest, the view that says who is in it
-- now) lists the player:
--
--   * roster lists the player          -> member, as before
--   * roster is usable, lacks the player -> left: no alliance
--   * no usable roster for the alliance  -> unchanged: nothing says they left
--
-- USABLE means the capture holds nearly all of the expected members. A roster the
-- collector scrolled only part way is not evidence of anyone leaving (0067 spent a
-- page on why a half-read capture must not be read as a mass departure), so the
-- view's own `snapshot_complete` is accepted, and so is a capture within 5% of the
-- game's member count. The tolerance is for the off-by-one that is routine (ES_1
-- 99 of 100, GNSQ 62 of 63): without it those alliances would stay uncorrected and
-- they are the ones with the largest ghost lists. The cost is that a real member
-- missing from such a capture shows with no alliance until the next one.
--
-- Where the roster cannot be read (a signed-in reader below member, which the view
-- gates) the alliance is simply unrostered and the old behaviour applies.
--
-- Same name, arguments and shape as 0262; only the membership changes.

create or replace function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with seen as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at, w.shield_end_at,
           p.power, p.current_alliance_id as last_alliance_id
      from public.latest_world_cities w
      left join public.players p on p.player_id = w.player_id
     where w.server_id = p_server_id
  ),
  -- Newest roster per alliance on this map, where it is complete enough to trust.
  roster as (
    select r.alliance_id, r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id in (select last_alliance_id from seen where last_alliance_id is not null)
       and (r.snapshot_complete
            or r.observed_members >= floor(r.expected_members * 0.95))
  ),
  rostered as (select distinct alliance_id from roster),
  b as (
    select s.game_uid, s.x, s.y, s.hq_level, s.name, s.captured_at, s.shield_end_at, s.power,
           case
             when s.last_alliance_id is null then null
             when not exists (select 1 from rostered x where x.alliance_id = s.last_alliance_id)
               then s.last_alliance_id
             when exists (select 1 from roster r
                           where r.alliance_id = s.last_alliance_id and r.game_uid = s.game_uid)
               then s.last_alliance_id
             else null
           end as alliance_id
      from seen s
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
  'A server''s swept bases with the alliance each belongs to NOW, plus the alliance ranking, as one jsonb (0260; shield 0262; current members only 0266: a player the alliance''s usable newest roster does not list has no alliance).';
