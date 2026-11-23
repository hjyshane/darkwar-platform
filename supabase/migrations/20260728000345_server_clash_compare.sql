-- 0345: server_clash_compare - two servers' strength side by side, for an admin.
--
-- Server Clash pits our server against another (580 vs 588 the first week, a
-- Saturday after a week of duels). Nothing in the schema says how strong a
-- WHOLE server is: the collector only ever reads boards - the cross-server
-- alliance board (top 100 alliances of the group), the cross-server power
-- board (top 150 players) - and the map. So this compares what can be seen,
-- and says which part of the server that is:
--
--   * each server's top 3 alliances by power (latest reading in the window);
--   * their members, taken from the MAP: a base's newest sighting that names
--     an alliance (0334, `world_city_snapshots.alliance_id`, 14 days back).
--     Not `alliance_roster_latest` - rosters exist for our alliances only -
--     and not `players.current_alliance_id`, which is a last-known value that
--     nothing clears;
--   * every member SEEN in the last 14 days (or `p_days` if longer) counts, even
--     once: a sighting is information, power comes from the newest
--     `server.rank` reading in that span. Who MOVED within `p_days` is a
--     separate figure: power up, kills up, HQ level up (player boards or map),
--     the base changed place or shield, or a truck of theirs was seen. Power
--     that only fell is not movement - losing troops is not playing.
--   * who is NOT known is said, not dropped: an alliance's official member
--     count minus the members seen is `needs_scan` (people the map never
--     showed), and a member seen with no power reading is `no_power_reading`.
--     Both need another scan.
--
-- It returns ONE jsonb document, not rows, so PostgREST's 1,000-row cap cannot
-- clip the member list (the trap 0144 and 0147 are about). Members are one
-- entry per person.
--
-- WHAT THIS CANNOT SAY, and the screen says it too: a player with no
-- `server.rank` reading has no power here, so a server whose people rarely reach
-- the top-150 board looks weaker than it is until they are scanned.
-- The collector sits on 580; 588 is seen through the group-wide boards and the
-- map sweeps only.
--
-- ADMIN ONLY, by raising: a non-admin gets 42501, not an empty document that
-- reads as "both servers are dead". SECURITY DEFINER because the snapshot
-- tables are member-readable by policy and this reads across alliances; the
-- role check is the first statement and nothing is written.

create or replace function public.server_clash_compare(
  p_server_a int,
  p_server_b int,
  p_days int default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 7), 1), 30);
  v_since timestamptz;
  v_members_since timestamptz;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'server_clash_compare is for admins' using errcode = '42501';
  end if;

  v_since := now() - make_interval(days => v_days);
  v_members_since := now() - make_interval(days => greatest(v_days, 14));

  return (
    with srv as (
      select distinct s.server_id from (values (p_server_a), (p_server_b)) as s (server_id)
    ),
    ranked as (
      select distinct on (s.alliance_id)
             s.alliance_id, s.server_id, s.code, s.name, s.power, s.member_count, s.captured_at
      from public.alliance_snapshots s
      where s.captured_at > v_since
        and s.power is not null
        and s.server_id in (select server_id from srv)
      order by s.alliance_id, s.captured_at desc
    ),
    top3 as (
      select r.*, row_number() over (partition by r.server_id order by r.power desc) as rn
      from ranked r
    ),
    t3 as (select * from top3 where rn <= 3),
    mem as (
      select m.player_id, m.game_uid, m.name, t.server_id, t.alliance_id, t.code, t.rn
      from (
        select distinct on (c.game_uid) c.game_uid, c.player_id, c.alliance_id, c.name
        from public.world_city_snapshots c
        where c.captured_at > v_members_since
          and c.server_id in (select server_id from srv)
          and c.alliance_id is not null
          and c.player_id is not null
        order by c.game_uid, c.captured_at desc
      ) m
      join t3 t on t.alliance_id = m.alliance_id
    ),
    pw as (
      select p.player_id,
             (array_agg(p.power order by p.captured_at asc)
               filter (where p.source_command = 'server.rank' and p.power is not null
                         and p.captured_at > v_since))[1] as power_first,
             (array_agg(p.power order by p.captured_at desc)
               filter (where p.source_command = 'server.rank' and p.power is not null))[1] as power_last,
             max(p.kills) filter (where p.captured_at > v_since)
               - min(p.kills) filter (where p.captured_at > v_since) as kills_gain,
             max(p.hq_level) filter (where p.captured_at > v_since)
               - min(p.hq_level) filter (where p.captured_at > v_since) as hq_gain
      from public.player_snapshots p
      where p.captured_at > v_members_since
        and p.player_id in (select player_id from mem)
      group by p.player_id
    ),
    mp as (
      select c.game_uid,
             count(distinct c.point_id) as places,
             count(distinct c.shield_end_at) as shield_states,
             max(c.hq_level) - min(c.hq_level) as map_hq_gain
      from public.world_city_snapshots c
      where c.captured_at > v_since
        and c.server_id in (select server_id from srv)
        and c.game_uid in (select game_uid from mem)
      group by c.game_uid
    ),
    tr as (
      select distinct t.owner_game_uid::bigint as game_uid
      from public.world_truck_snapshots t
      where t.captured_at > v_since
        and t.owner_game_uid ~ '^[0-9]+$'
    ),
    f as (
      select m.server_id, m.rn, m.code, m.player_id, m.game_uid, m.name,
             pw.power_last,
             pw.power_last - pw.power_first as power_gain,
             coalesce(pw.kills_gain, 0) as kills_gain,
             coalesce(pw.hq_gain, 0) + coalesce(mp.map_hq_gain, 0) as hq_gain,
             coalesce(mp.places, 0) > 1 as moved,
             coalesce(mp.shield_states, 0) > 1 as shield_changed,
             (tr.game_uid is not null) as trucked
      from mem m
      left join pw on pw.player_id = m.player_id
      left join mp on mp.game_uid = m.game_uid
      left join tr on tr.game_uid = m.game_uid
    ),
    f2 as (
      select f.*,
             (coalesce(f.power_gain, 0) > 0 or f.kills_gain > 0 or f.hq_gain > 0
              or f.moved or f.shield_changed or f.trucked) as active
      from f
    ),
    sv as (
      select f2.server_id,
             count(*) as members_seen,
             count(*) filter (where active) as active_players,
             count(*) filter (where power_last is not null) as power_known,
             sum(power_last) as total_power,
             percentile_cont(0.5) within group (order by power_last) as median_power,
             max(power_last) as top_power,
             sum(greatest(power_gain, 0)) as power_gained,
             count(*) filter (where power_gain > 0) as growing,
             count(*) filter (where moved or shield_changed or trucked) as map_active,
             count(*) filter (where power_last is null) as no_power_reading
      from f2
      group by f2.server_id
    ),
    al as (
      select t.server_id, t.rn, t.code, t.name, t.power, t.member_count,
             count(f2.player_id) as members_seen,
             count(f2.player_id) filter (where f2.active) as active_players,
             greatest(coalesce(t.member_count, 0) - count(f2.player_id), 0) as needs_scan,
             sum(f2.power_last) as total_power,
             max(f2.power_last) as top_power
      from t3 t
      left join f2 on f2.server_id = t.server_id and f2.rn = t.rn
      group by t.server_id, t.rn, t.code, t.name, t.power, t.member_count
    )
    select jsonb_build_object(
      'days', v_days,
      'generated_at', now(),
      'servers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'server_id', s.server_id,
                 'alliances_on_board', coalesce((select count(*) from t3 where t3.server_id = s.server_id), 0),
                 'members_seen', coalesce(v.members_seen, 0),
                 'members_official', coalesce((select sum(a.member_count) from al a where a.server_id = s.server_id), 0),
                 'unseen_members', coalesce((select sum(a.needs_scan) from al a where a.server_id = s.server_id), 0),
                 'active_players', coalesce(v.active_players, 0),
                 'power_known', coalesce(v.power_known, 0),
                 'total_power', coalesce(v.total_power, 0),
                 'median_power', v.median_power,
                 'top_power', v.top_power,
                 'power_gained', coalesce(v.power_gained, 0),
                 'growing', coalesce(v.growing, 0),
                 'map_active', coalesce(v.map_active, 0),
                 'no_power_reading', coalesce(v.no_power_reading, 0)
               ) order by s.server_id)
        from srv s left join sv v on v.server_id = s.server_id
      ), '[]'::jsonb),
      'alliances', coalesce((
        select jsonb_agg(to_jsonb(a) order by a.server_id, a.rn) from al a
      ), '[]'::jsonb),
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'server_id', p.server_id,
                 'alliance_code', p.code,
                 'game_uid', p.game_uid::text,
                 'name', p.name,
                 'power', p.power_last,
                 'power_gain', p.power_gain,
                 'kills_gain', p.kills_gain,
                 'hq_gain', p.hq_gain,
                 'moved', p.moved,
                 'shield_changed', p.shield_changed,
                 'trucked', p.trucked,
                 'moving', p.active
               ) order by p.server_id, p.power_last desc nulls last, p.game_uid)
        from f2 p
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.server_clash_compare(int, int, int) from public, anon;
grant execute on function public.server_clash_compare(int, int, int) to authenticated;

comment on function public.server_clash_compare(int, int, int) is
  'Two servers compared through their top 3 alliances and the members seen on the map (0345). '
  'One jsonb document: servers, alliances, players. Anyone seen once counts; who moved in the last '
  'p_days is a separate figure. Members not seen at all (unseen_members) or seen with no server.rank '
  'power (no_power_reading) are the ones that need another scan. '
  'Admins only: anyone else gets 42501.';
