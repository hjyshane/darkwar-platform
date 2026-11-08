-- 0310: alliance_moves — the movement feed for the alliance page.
--
-- Who joined from where, who left to where, with their power at the time, for
-- every player we observe anywhere. The source is player_snapshots (0003):
-- it carries alliance_external_id, power, server_id and captured_at per
-- observation and is readable by every signed-in role. It is the ONLY source.
-- alliance_member_snapshots is own-or-officer (0066) and a union would force a
-- definer view that leaks roster reads; players.current_alliance_id is
-- last-known and never cleared (CLAUDE.md) so it cannot say when anyone left.
--
-- WHAT A MOVE IS. The first observation where a player's alliance differs from
-- their previous observation. One row per move, built here, so the client
-- never has a row per detail to collapse (PostgREST's 1,000-row cap would drop
-- whole moves in silence). A player seen once has no previous observation and
-- no move; two captures at the same instant that disagree (two boards in one
-- observation) are not a change either, so a move needs captured_at to have
-- advanced.
--
-- RELOCATION. alliances is unique on (server_id, external_id), so an alliance
-- that moved server is two rows. When the previous and next observation share
-- an external_id and differ in server_id the direction is `relocated`, listed
-- under the alliance's NEW row and pointing at the old one; the old row shows
-- nothing, not a leave. Where the new row has not been catalogued yet there is
-- nothing to list it under, and nothing is listed.
--
-- WHO SEES IT (user decision 2026-11-08). For an own alliance: its members and
-- officers (an alliance_memberships row for auth.uid() and that alliance,
-- 0309's belongs_to_alliance) and admins; a community account or a member of
-- another own alliance gets zero rows. For any other alliance: every signed-in
-- role, since community already reads those rosters (0283). The branch lives
-- here so the page carries no role logic. security invoker: the caller's own
-- policies on player_snapshots and alliances apply.
--
-- COVERAGE is "players who appear on any board or profile we capture", and a
-- move is seen only when we next observe the player. The tab says so.

-- Leads with server_id (schema rule). Finds the players who ever belonged to
-- an alliance on a server, which is the seed of every call.
create index player_snapshots_server_alliance_player_idx
  on public.player_snapshots (server_id, alliance_external_id, player_id)
  where alliance_external_id is not null;

create function public.alliance_moves(
  p_alliance uuid,
  p_since timestamptz default now() - interval '90 days'
)
returns table (
  player_id uuid,
  game_uid bigint,
  player_name text,
  direction text,
  other_alliance_id uuid,
  other_alliance_tag text,
  other_alliance_name text,
  other_server_id int,
  power_at bigint,
  observed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select a.alliance_id, a.server_id, a.external_id
      from public.alliances a
     where a.alliance_id = p_alliance
       and (not a.is_own or public.belongs_to_alliance(a.alliance_id))
  ),
  -- Everyone ever seen under this external id, on any server: a relocated
  -- member's old rows are under the old server.
  touching as (
    select distinct s.player_id
      from public.player_snapshots s
      join target t on s.alliance_external_id = t.external_id
  ),
  -- Their observations inside the window, plus the newest one before it so
  -- the first row in the window has something to differ from.
  hist as (
    select s.player_id, s.snapshot_id, s.server_id, s.alliance_external_id, s.power, s.captured_at
      from public.player_snapshots s
      join touching t on t.player_id = s.player_id
     where s.captured_at >= p_since
    union all
    select h.player_id, h.snapshot_id, h.server_id, h.alliance_external_id, h.power, h.captured_at
      from touching t
      cross join lateral (
        select s.player_id, s.snapshot_id, s.server_id, s.alliance_external_id, s.power, s.captured_at
          from public.player_snapshots s
         where s.player_id = t.player_id
           and s.captured_at < p_since
         order by s.captured_at desc, s.snapshot_id desc
         limit 1
      ) h
  ),
  steps as (
    select h.*,
           lag(h.server_id)            over w as prev_server_id,
           lag(h.alliance_external_id) over w as prev_alliance_external_id,
           lag(h.captured_at)          over w as prev_captured_at
      from hist h
    window w as (partition by h.player_id order by h.captured_at, h.snapshot_id)
  ),
  moves as (
    select st.player_id, st.power, st.captured_at,
           case
             when st.server_id = t.server_id
              and st.alliance_external_id = t.external_id
              and st.prev_alliance_external_id is distinct from t.external_id
               then 'in'
             when st.prev_server_id = t.server_id
              and st.prev_alliance_external_id = t.external_id
              and st.alliance_external_id is distinct from t.external_id
               then 'out'
             when st.server_id = t.server_id
              and st.alliance_external_id = t.external_id
              and st.prev_alliance_external_id = t.external_id
              and st.prev_server_id <> t.server_id
               then 'relocated'
           end as direction,
           -- The other side: where they came from on in/relocated, where
           -- they went on out.
           case when st.server_id = t.server_id and st.alliance_external_id = t.external_id
                then st.prev_server_id else st.server_id end as other_server,
           case when st.server_id = t.server_id and st.alliance_external_id = t.external_id
                then st.prev_alliance_external_id else st.alliance_external_id end as other_external
      from steps st
     cross join target t
     where st.prev_captured_at is not null
       and st.captured_at > st.prev_captured_at
       and st.captured_at >= p_since
  )
  select m.player_id,
         p.game_uid,
         p.current_name as player_name,
         m.direction,
         o.alliance_id as other_alliance_id,
         o.current_code as other_alliance_tag,
         o.current_name as other_alliance_name,
         case when m.other_external is not null then m.other_server end as other_server_id,
         m.power as power_at,
         m.captured_at as observed_at
    from moves m
    join public.players p on p.player_id = m.player_id
    left join public.alliances o
      on m.other_external is not null
     and o.server_id = m.other_server
     and o.external_id = m.other_external
   where m.direction is not null
   order by m.captured_at desc, p.game_uid;
$$;

revoke all on function public.alliance_moves(uuid, timestamptz) from public, anon;
grant execute on function public.alliance_moves(uuid, timestamptz) to authenticated, service_role;

comment on function public.alliance_moves(uuid, timestamptz) is
  'One row per observed alliance change touching p_alliance since p_since (default 90 '
  'days): direction in/out/relocated, the other alliance when catalogued, the player''s '
  'power at the time. From player_snapshots only. Own alliances: members, officers and '
  'admins; other alliances: every signed-in role. security invoker (0310).';
