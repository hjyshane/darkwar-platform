-- 0334: the map says which alliance a base is in, and where a player lives.
--
-- 566-588 next to 580. Since 2026-11-18 the owner's own UI macro pans every
-- server in the group, so world.get.new viewports reach the journal for all of
-- them. The map for 580 already looked right; the others did not, for two
-- reasons that are the same reason: everything the map knew about a player
-- beyond their position came from boards and alliance rosters, and those are
-- read almost only for 580.
--
--   * map_atlas coloured a base by players.current_alliance_id. A player only
--     ever seen on the map has none, so 566's bases were grey dots with no
--     alliance ranking, and a migrant kept the alliance they left (the column
--     is last-known and never cleared, CLAUDE.md).
--   * player_server_moves (0320) is written from boards and rosters only, so a
--     server nobody reads the rosters of had no arrivals and no departures.
--
-- THE TILE ALREADY SAYS BOTH. A city tile carries the alliance the player is
-- in at that moment (f3.7 its id, f3.15 its tag; the client's own proto names
-- them allianceId and alAbbr), and a base stands on exactly one server's map.
-- Checked 2026-11-18/19 on the journal: 3.7 equals the newest roster's
-- alliance in 1,033 of 1,037 players read both ways (the 4 left or moved
-- after the roster was read), 3.15 equals the alliance code in 1,076 of 1,076,
-- and the map's server equals the roster's curServerId in 22,571 of 22,571
-- map sightings within 12 hours of a roster reading (2,518 players).
--
-- WHAT THIS DOES
--
-- 1. world_city_snapshots gains in_alliance / alliance_id / alliance_code,
--    written by parser 1.7.0. in_alliance is true or false on new rows and
--    NULL on every older row, which never looked: "no alliance" and "did not
--    look" are different answers and only the flag tells them apart. No FK on
--    alliance_id, as 0254/0320 on their servers: a failed insert here stalls
--    the outbox. The sync worker creates the alliance under the MAP's server
--    when it has never been seen, exactly as it does for a board.
--
-- 2. map_atlas: the alliance of a base is the one the map drew it in at its
--    newest sighting there. Only a row from before 1.7.0 falls back to 0266's
--    rule (last-known alliance, kept only while the roster agrees).
--
-- 3. A map sighting is a sighting for player_server_moves. A third trigger, on
--    world_city_snapshots, hands internal.record_server_sightings the map's
--    server; the recorder also looks at map sightings for last_seen_from_at.
--    Every server swept gets its arrivals and departures, which is what the
--    migration board and the player page read. Backfilled below.
--
--    THE RISK, written down so it is checked when it happens: a cross-server
--    event that puts players' bases on another server's map (a server war
--    teleport) would read as a move there and back. None has been seen - not
--    one of 41,711 players on the map since 11-01 was on two maps - and
--    seen_at / last_seen_from_at make such a pair easy to find if it appears.
--
-- 4. dispatch_missions_live files a mission under the map it stands on (the
--    tile's f103, which every mission row's raw carries) and finds its
--    alliance by id on any server. Parser 1.7.0 writes the map's server too;
--    the view reads raw so the missions written before it are right today.
--    It was the owner's uid server: 498 of 4,136 mission sightings on 580 on
--    2026-11-18 belonged to people who had migrated in, and they were listed on
--    the servers those people had left.
--
-- NOT HERE: trucks need no SQL. Their legs on other servers arrive in
-- push.world.march.world.get.new, which parser 1.2.0 of world_trucks now
-- reads, into the same table and view.

alter table public.world_city_snapshots
  add column in_alliance boolean,
  add column alliance_id uuid,
  add column alliance_code text;

comment on column public.world_city_snapshots.in_alliance is
  'Whether the map drew this base in an alliance at this sighting (0334, tile f3.7). NULL on rows written before parser 1.7.0, which did not look.';
comment on column public.world_city_snapshots.alliance_id is
  'The alliance the map drew this base in (0334), resolved from the tile''s f3.7 by the sync worker. No FK: a failed insert would stall the outbox.';
comment on column public.world_city_snapshots.alliance_code is
  'The alliance tag the map printed at this sighting (0334, tile f3.15).';

-- ---------------------------------------------------------------------------
-- 2. map_atlas

create or replace function public.map_atlas(p_server_id int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive
  -- uids with a sighting on this map: new rows by map_server_id, old rows
  -- (map_server_id null) by their home server. Two loose index scans.
  uids_new as (
    (select w.game_uid
       from public.world_city_snapshots w
      where w.map_server_id = p_server_id
      order by w.game_uid
      limit 1)
    union all
    select (select w.game_uid
              from public.world_city_snapshots w
             where w.map_server_id = p_server_id and w.game_uid > u.game_uid
             order by w.game_uid
             limit 1)
      from uids_new u
     where u.game_uid is not null
  ),
  uids_old as (
    (select w.game_uid
       from public.world_city_snapshots w
      where w.server_id = p_server_id and w.map_server_id is null
      order by w.game_uid
      limit 1)
    union all
    select (select w.game_uid
              from public.world_city_snapshots w
             where w.server_id = p_server_id and w.map_server_id is null
               and w.game_uid > u.game_uid
             order by w.game_uid
             limit 1)
      from uids_old u
     where u.game_uid is not null
  ),
  uids as (
    select game_uid from uids_new where game_uid is not null
    union
    select game_uid from uids_old where game_uid is not null
  ),
  latest as (
    select l.*
      from uids u
      cross join lateral (
        select w.game_uid, w.player_id, w.x, w.y, w.hq_level, w.name,
               w.captured_at, w.shield_end_at, w.map_server_id,
               w.in_alliance, w.alliance_id as map_alliance_id, w.alliance_code as map_code
          from public.world_city_snapshots w
         where w.game_uid = u.game_uid
           and coalesce(w.map_server_id, w.server_id) = p_server_id
         order by w.captured_at desc
         limit 1) l
     -- gone: the same uid was seen on a different map after this sighting
     where not exists (
       select 1 from public.world_city_snapshots o
        where o.game_uid = u.game_uid
          and o.captured_at > l.captured_at
          and coalesce(o.map_server_id, o.server_id) <> p_server_id)
  ),
  seen as (
    select w.game_uid, w.x, w.y, w.hq_level, w.name, w.captured_at, w.shield_end_at,
           w.in_alliance, w.map_alliance_id, w.map_code,
           p.power, p.current_alliance_id as last_alliance_id
      from latest w
      left join public.players p on p.player_id = w.player_id
     -- a player the collector has read on ANOTHER server has moved: their base
     -- here is the one they left. Unknown (no player row, no server) stays.
     where w.map_server_id is not null or p.server_id is null or p.server_id = p_server_id
  ),
  -- 0266's roster check, for the rows that predate the map's own answer.
  roster as (
    select r.alliance_id, r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id in (select last_alliance_id from seen
                              where in_alliance is null and last_alliance_id is not null)
       and (r.snapshot_complete
            or r.observed_members >= floor(r.expected_members * 0.95))
  ),
  rostered as (select distinct alliance_id from roster),
  b as (
    select s.game_uid, s.x, s.y, s.hq_level, s.name, s.captured_at, s.shield_end_at, s.power,
           s.map_code,
           case
             -- the map drew it in no alliance, or in this one (0334)
             when s.in_alliance is false then null
             when s.in_alliance and s.map_alliance_id is not null then s.map_alliance_id
             -- an older row: the last alliance the player was seen in, while
             -- a complete roster of it still has them
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
    select al.alliance_id,
           -- the tag on the map is as fresh as the sweep; the alliance row's
           -- code is whatever the first board or tile that named it said
           coalesce((select b2.map_code from b b2
                      where b2.alliance_id = al.alliance_id and b2.map_code is not null
                      order by b2.captured_at desc limit 1),
                    al.current_code) as current_code,
           al.current_name,
           count(*) as bases,
           coalesce(sum(b.power), 0) as power
      from b
      join public.alliances al on al.alliance_id = b.alliance_id
     group by al.alliance_id, al.current_code, al.current_name
  ),
  ranked as (
    select a.*, row_number() over (order by a.bases desc, a.current_code) - 1 as ord
      from a
  )
  select jsonb_build_object(
    'alliances', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.alliance_id, 'code', r.current_code, 'name', r.current_name,
               'bases', r.bases, 'power', r.power) order by r.ord)
        from ranked r), '[]'::jsonb),
    'bases', coalesce((
      select jsonb_agg(jsonb_build_array(
               b.game_uid, b.x, b.y, b.hq_level, b.power, coalesce(r.ord, -1),
               extract(epoch from b.captured_at)::bigint, b.name,
               extract(epoch from b.shield_end_at)::bigint))
        from b left join ranked r on r.alliance_id = b.alliance_id), '[]'::jsonb)
  );
$$;

comment on function public.map_atlas(int) is
  'A server''s swept bases with the alliance each belongs to NOW, plus the alliance ranking, as one jsonb (0260; shield 0262; current members only 0266; loose index scan 0269; a base follows the map it was seen on 0318; a player known to live on another server is not on this map unless seen here 0321; the alliance is the one the map drew the base in 0334).';

-- ---------------------------------------------------------------------------
-- 3. Map sightings are sightings for player_server_moves.
--
-- The recorder is 0320's, with one more place a player can have last been seen
-- on the server they left: that server's map.

create or replace function internal.record_server_sightings(
  p_player uuid[],
  p_server int[],
  p_at timestamptz[],
  p_source text[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  with s as (
    select u.player_id, u.server_id, u.seen_at, u.source
      from unnest(p_player, p_server, p_at, p_source) as u(player_id, server_id, seen_at, source)
     where u.player_id is not null and u.server_id is not null and u.seen_at is not null
  ),
  -- One server per player per instant; an instant whose readings disagree says
  -- nothing.
  inst as (
    select s.player_id, s.seen_at, min(s.server_id) as server_id, min(s.source) as source
      from s
     group by s.player_id, s.seen_at
    having min(s.server_id) = max(s.server_id)
  ),
  -- Where each player stood before these sightings: their newest recorded
  -- move, else the server their uid was made on, since the beginning of time.
  prior as (
    select p.player_id, p.game_uid,
           coalesce(m.to_server_id, (p.game_uid % 1000000)::int) as server_id,
           coalesce(m.seen_at, '-infinity'::timestamptz) as seen_at
      from public.players p
      left join lateral (
        select x.to_server_id, x.seen_at
          from public.player_server_moves x
         where x.player_id = p.player_id
         order by x.seen_at desc
         limit 1
      ) m on true
     where p.player_id in (select i.player_id from inst i)
  ),
  seq as (
    select pr.player_id, pr.server_id, pr.seen_at, null::text as source, true as is_prior
      from prior pr
    union all
    select i.player_id, i.server_id, i.seen_at, i.source, false
      from inst i
      join prior pr on pr.player_id = i.player_id
     where i.seen_at > pr.seen_at
  ),
  stepped as (
    select q.player_id, q.server_id, q.seen_at, q.source, q.is_prior,
           lag(q.server_id) over (partition by q.player_id order by q.seen_at) as from_server_id
      from seq q
  )
  insert into public.player_server_moves
    (player_id, game_uid, from_server_id, to_server_id, seen_at, last_seen_from_at, source_command)
  select st.player_id, pr.game_uid, st.from_server_id, st.server_id, st.seen_at,
         -- The newest trusted sighting on the old server before this one, from
         -- any of the three tables. All are indexed for it: the two snapshot
         -- tables on (player_id, captured_at desc), the map on
         -- (map_server_id, game_uid, captured_at desc) (0318).
         greatest(
           (select ps.captured_at
              from public.player_snapshots ps
             where ps.player_id = st.player_id
               and ps.captured_at < st.seen_at
               and ps.server_id = st.from_server_id
               and case when (ps.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
                        then (ps.raw ->> 'serverId')::int end = ps.server_id
             order by ps.captured_at desc
             limit 1),
           (select am.captured_at
              from public.alliance_member_snapshots am
             where am.player_id = st.player_id
               and am.captured_at < st.seen_at
               and am.server_id = st.from_server_id
               and case when coalesce(am.raw ->> 'curServerId', am.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
                        then coalesce(am.raw ->> 'curServerId', am.raw ->> 'serverId')::int end
                   = am.server_id
             order by am.captured_at desc
             limit 1),
           (select w.captured_at
              from public.world_city_snapshots w
             where w.map_server_id = st.from_server_id
               and w.game_uid = pr.game_uid
               and w.captured_at < st.seen_at
             order by w.captured_at desc
             limit 1)
         ),
         st.source
    from stepped st
    join prior pr on pr.player_id = st.player_id
   where not st.is_prior
     and st.server_id <> st.from_server_id
  on conflict (player_id, seen_at) do nothing;
$$;

revoke all on function internal.record_server_sightings(uuid[], int[], timestamptz[], text[])
  from public, anon, authenticated;

comment on function internal.record_server_sightings(uuid[], int[], timestamptz[], text[]) is
  'Writes a player_server_moves row for every server change in the given sightings (0320; map sightings 0334). '
  'Callers pass only sightings that name the server: a board or roster entry''s own serverId, or the map a base stands on.';

-- A base on a server's map is the player living on that server. Rows from
-- before 0318 have no map_server_id and say nothing.
create function internal.world_city_snapshots_record_server_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.record_server_sightings(
    array_agg(n.player_id), array_agg(n.map_server_id), array_agg(n.captured_at),
    array_agg(n.source_command))
    from new_rows n
   where n.player_id is not null
     and n.map_server_id is not null;
  return null;
exception when others then
  -- Never stall the outbox over the move log (0320).
  raise warning '0334 player_server_moves (world_city_snapshots): % %', sqlstate, sqlerrm;
  return null;
end;
$$;

revoke all on function internal.world_city_snapshots_record_server_moves()
  from public, anon, authenticated;

create trigger record_server_moves
  after insert on public.world_city_snapshots
  referencing new table as new_rows
  for each statement execute function internal.world_city_snapshots_record_server_moves();

-- Backfill: every map sighting so far, together with the board and roster
-- sightings of the same players, in one call so each player's sequence is
-- whole. A player is a candidate when the map has them somewhere other than
-- the server their uid was made on, or when a move is already recorded (they
-- may have gone home). Sightings older than a player's newest recorded move
-- are ignored by the recorder, so nothing 0320 wrote is second-guessed.

with candidates as (
  select distinct w.player_id
    from public.world_city_snapshots w
   where w.player_id is not null
     and w.map_server_id is not null
     and w.map_server_id <> (w.game_uid % 1000000)
  union
  select distinct m.player_id from public.player_server_moves m
),
sightings as (
  select w.player_id, w.map_server_id as server_id, w.captured_at, w.source_command
    from public.world_city_snapshots w
   where w.player_id in (select c.player_id from candidates c)
     and w.map_server_id is not null
  union all
  select ps.player_id, ps.server_id, ps.captured_at, ps.source_command
    from public.player_snapshots ps
   where ps.player_id in (select c.player_id from candidates c)
     and case when (ps.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
              then (ps.raw ->> 'serverId')::int end = ps.server_id
  union all
  select am.player_id, am.server_id, am.captured_at, am.source_command
    from public.alliance_member_snapshots am
   where am.player_id in (select c.player_id from candidates c)
     and case when coalesce(am.raw ->> 'curServerId', am.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
              then coalesce(am.raw ->> 'curServerId', am.raw ->> 'serverId')::int end
         = am.server_id
)
select internal.record_server_sightings(
         array_agg(player_id), array_agg(server_id), array_agg(captured_at),
         array_agg(source_command))
  from sightings;

comment on table public.player_server_moves is
  'Every server change seen for a player (0320), one row per move, never rewritten. '
  'seen_at is the first sighting on to_server_id; the move happened after '
  'last_seen_from_at (null = never seen on from_server_id). The first server is the '
  'uid''s last six digits. Only sightings that name the server count: a board or roster '
  'entry''s own serverId, or the map a base was seen on (0334).';

-- ---------------------------------------------------------------------------
-- 4. A mission is on the map it stands on.
--
-- Same columns, same order: only server_id's source and the alliance lookup
-- change. raw is the tile as decoded, {"103": [<map server>], ...}.

create or replace view public.dispatch_missions_live
with (security_invoker = true) as
select latest.*,
       p.current_name as owner_name,
       al.current_code as alliance_abbr
  from (
    select distinct on (s.mission_uuid)
           s.mission_uuid,
           coalesce(
             case when (s.raw -> '103' ->> 0) ~ '^[0-9]{1,9}$'
                  then (s.raw -> '103' ->> 0)::int end,
             s.server_id) as server_id,
           s.point_id,
           s.x,
           s.y,
           s.mission_id,
           s.owner_game_uid,
           s.alliance_external_id,
           s.started_at,
           s.ends_at,
           s.captured_at as seen_at,
           g.color,
           g.star,
           g.orange_books,
           g.steal_max,
           g.is_special,
           g.steal_items
      from public.dispatch_mission_snapshots s
      join public.game_dispatch_missions g using (mission_id)
     where s.captured_at > now() - interval '1 day'
     order by s.mission_uuid, s.captured_at desc
  ) latest
  left join public.players p on p.game_uid = latest.owner_game_uid
  -- By id on any server: the alliance may be filed under the server it came
  -- from. The one on this map first, then the one seen last.
  left join lateral (
    select a.current_code
      from public.alliances a
     where a.external_id = latest.alliance_external_id
     order by (a.server_id = latest.server_id) desc, a.last_seen_at desc nulls last
     limit 1
  ) al on true
 where latest.ends_at > now();

comment on view public.dispatch_missions_live is
  'Started dispatch missions whose finish instant has not passed (0254), with their colour '
  'and Orange Skill Book count from game_dispatch_missions and the owner''s name. server_id '
  'is the map the mission stands on, from the tile (0334).';
