-- 0320: player_server_moves - every server a player has moved to, kept for good.
--
-- The migration boards (0300, 0303, 0305) answer "who is on another server than
-- the one their uid ends in" from the NEWEST reading, so they can say where a
-- player started (the uid's last six digits, ADR-0001 D-1) and where they are
-- now, and nothing about the hops between. The roster writer (0032) overwrites
-- players.server_id with the newest server, so the previous one is gone too.
-- The next migration window would make this window's movers unreadable. So the
-- moves are written down when they are seen, one row per move, and never
-- rewritten.
--
-- WHAT A MOVE IS. A player's server differs from the one they stood on before.
-- "Before" is the to_server_id of their newest recorded move, or, with no move
-- recorded, the server their uid was made on. So the first sighting of a player
-- away from home is a move from home (last_seen_from_at says whether we ever saw
-- them there), and a later return home is a move too.
--
-- seen_at is the FIRST sighting on the new server, not the moment of the move:
-- the collector sees a player only when a board or roster naming them is read.
-- The move happened between last_seen_from_at (the newest sighting on the old
-- server before it, null when there is none) and seen_at.
--
-- WHICH SIGHTINGS COUNT. Only rows whose raw payload itself named the server:
-- `serverId` on a board entry (player_snapshots), `curServerId`/`serverId` on a
-- roster member (alliance_member_snapshots), equal to the row's server_id. Every
-- normalizer falls back to the uid's home server when the payload has no
-- serverId (0319 notes this), and such a row would read a mover as back home
-- and then away again: two moves that never happened. A row without it is
-- skipped, which costs a sighting and never invents a move. Two readings of
-- one player at the same instant that disagree are skipped for the same reason.
--
-- Sightings older than the newest recorded move are ignored (a late batch
-- cannot be placed between moves already written). The backfill below replays
-- all history in one call, so history is complete from the start.
--
-- WRITE PATH. Statement triggers on both snapshot tables call one recorder. A
-- failure in it must not stall the outbox (a raised error rolls back the
-- snapshot insert and the sync retries it forever), so the triggers turn an
-- error into a warning in the Postgres log. That is the one place an error is
-- not raised, and it is deliberate.
--
-- WHO READS. The same roles as players (member, officer, admin, community;
-- 0065, 0283): players.server_id already shows those roles where a player is
-- now, and this is the same fact over time.

create table public.player_server_moves (
  move_id bigint generated always as identity primary key,
  player_id uuid not null references public.players (player_id) on delete cascade,
  game_uid bigint not null,
  -- No FK on either server, as 0254/0317: a move may involve a server outside
  -- the tracked group, and a failed insert here must never fail a snapshot.
  from_server_id int not null,
  to_server_id int not null,
  -- First sighting on to_server_id.
  seen_at timestamptz not null,
  -- Newest sighting on from_server_id before seen_at; null = never seen there
  -- (a move from the uid's home server that we only learn of afterwards).
  last_seen_from_at timestamptz,
  -- The source_command of the first sighting on the new server.
  source_command text not null,
  created_at timestamptz not null default now(),
  constraint player_server_moves_changes_server check (from_server_id <> to_server_id),
  constraint player_server_moves_one_per_instant unique (player_id, seen_at)
);

-- server_id leads (schema rule): the per-server in/out reads.
create index player_server_moves_to_idx
  on public.player_server_moves (to_server_id, seen_at desc);
create index player_server_moves_from_idx
  on public.player_server_moves (from_server_id, seen_at desc);

alter table public.player_server_moves enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207).
revoke all on public.player_server_moves from anon, authenticated;
grant select on public.player_server_moves to authenticated;
grant all on public.player_server_moves to service_role;

create policy member_read on public.player_server_moves
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin', 'community'));

comment on table public.player_server_moves is
  'Every server change seen for a player (0320), one row per move, never rewritten. '
  'seen_at is the first sighting on to_server_id; the move happened after '
  'last_seen_from_at (null = never seen on from_server_id). The first server is the '
  'uid''s last six digits. Only sightings whose payload named the server count.';

-- ---------------------------------------------------------------------------
-- The recorder. Arrays rather than a table argument so both triggers and the
-- backfill can hand it whatever they collected. Internal: nothing in the API
-- may call it.

create function internal.record_server_sightings(
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
         -- either table. Both are indexed (player_id, captured_at desc).
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
  'Writes a player_server_moves row for every server change in the given sightings (0320). '
  'Callers pass only sightings whose payload named the server.';

-- ---------------------------------------------------------------------------
-- The triggers. AFTER, statement level, transition table: one call per batch.

create function internal.player_snapshots_record_server_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.record_server_sightings(
    array_agg(n.player_id), array_agg(n.server_id), array_agg(n.captured_at),
    array_agg(n.source_command))
    from new_rows n
   where n.player_id is not null
     and case when (n.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
              then (n.raw ->> 'serverId')::int end = n.server_id;
  return null;
exception when others then
  -- Never stall the outbox over the move log (see the header).
  raise warning '0320 player_server_moves (player_snapshots): % %', sqlstate, sqlerrm;
  return null;
end;
$$;

create function internal.alliance_member_snapshots_record_server_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.record_server_sightings(
    array_agg(n.player_id), array_agg(n.server_id), array_agg(n.captured_at),
    array_agg(n.source_command))
    from new_rows n
   where n.player_id is not null
     and case when coalesce(n.raw ->> 'curServerId', n.raw ->> 'serverId') ~ '^[0-9]{1,9}$'
              then coalesce(n.raw ->> 'curServerId', n.raw ->> 'serverId')::int end
         = n.server_id;
  return null;
exception when others then
  raise warning '0320 player_server_moves (alliance_member_snapshots): % %', sqlstate, sqlerrm;
  return null;
end;
$$;

revoke all on function internal.player_snapshots_record_server_moves() from public, anon, authenticated;
revoke all on function internal.alliance_member_snapshots_record_server_moves() from public, anon, authenticated;

create trigger record_server_moves
  after insert on public.player_snapshots
  referencing new table as new_rows
  for each statement execute function internal.player_snapshots_record_server_moves();

create trigger record_server_moves
  after insert on public.alliance_member_snapshots
  referencing new table as new_rows
  for each statement execute function internal.alliance_member_snapshots_record_server_moves();

-- ---------------------------------------------------------------------------
-- Backfill: every trusted sighting of every player ever seen away from home,
-- in one call so the sequence is whole. Players never seen away from home have
-- no move to find, so the candidates are found on plain columns first and the
-- payloads are read only for them.

with candidates as (
  select distinct ps.player_id
    from public.player_snapshots ps
   where ps.player_id is not null and (ps.game_uid % 1000000) <> ps.server_id
  union
  select distinct am.player_id
    from public.alliance_member_snapshots am
   where am.player_id is not null and (am.game_uid % 1000000) <> am.server_id
),
sightings as (
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

-- ---------------------------------------------------------------------------
-- Reads.

-- One server's arrivals and departures, one row per move, newest first. The
-- player's name, power and alliance are their CURRENT ones (players), and the
-- alliance is last-known (CLAUDE.md: never cleared), which the screen says.
create function public.server_migration_flow(
  p_server int,
  p_since timestamptz default '-infinity'
)
returns table (
  move_id bigint,
  direction text,
  player_id uuid,
  game_uid bigint,
  player_name text,
  home_server int,
  other_server_id int,
  seen_at timestamptz,
  last_seen_from_at timestamptz,
  power bigint,
  alliance_id uuid,
  alliance_code text,
  alliance_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.move_id,
         case when m.to_server_id = p_server then 'in' else 'out' end,
         m.player_id, m.game_uid, p.current_name, (m.game_uid % 1000000)::int,
         case when m.to_server_id = p_server then m.from_server_id else m.to_server_id end,
         m.seen_at, m.last_seen_from_at, p.power,
         a.alliance_id, a.current_code, a.current_name
    from (
      select x.* from public.player_server_moves x
       where x.to_server_id = p_server and x.seen_at >= p_since
      union all
      select x.* from public.player_server_moves x
       where x.from_server_id = p_server and x.seen_at >= p_since
    ) m
    join public.players p on p.player_id = m.player_id
    left join public.alliances a on a.alliance_id = p.current_alliance_id
   order by m.seen_at desc, m.move_id desc;
$$;

-- One row per server that has any move: how many PEOPLE arrived and left (a
-- player who came and went twice counts once each way), and the newest move.
create function public.server_migration_summary(
  p_since timestamptz default '-infinity'
)
returns table (
  server_id int,
  arrived bigint,
  departed bigint,
  last_move_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with legs as (
    select m.to_server_id as server_id, m.player_id, 'in'::text as direction, m.seen_at
      from public.player_server_moves m
     where m.seen_at >= p_since
    union all
    select m.from_server_id, m.player_id, 'out', m.seen_at
      from public.player_server_moves m
     where m.seen_at >= p_since
  )
  select l.server_id,
         count(distinct l.player_id) filter (where l.direction = 'in'),
         count(distinct l.player_id) filter (where l.direction = 'out'),
         max(l.seen_at)
    from legs l
   group by l.server_id
   order by l.server_id;
$$;

revoke all on function public.server_migration_flow(int, timestamptz) from public, anon, authenticated;
revoke all on function public.server_migration_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.server_migration_flow(int, timestamptz) to authenticated, service_role;
grant execute on function public.server_migration_summary(timestamptz) to authenticated, service_role;

comment on function public.server_migration_flow(int, timestamptz) is
  'One server''s moves (0320): direction in/out, the other server, when first seen there and '
  'when last seen before. Name, power and alliance are the player''s current ones.';
comment on function public.server_migration_summary(timestamptz) is
  'Per server with any move (0320): distinct players who arrived and who left since p_since, '
  'and the newest move.';
