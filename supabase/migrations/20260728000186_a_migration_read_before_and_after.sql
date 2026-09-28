-- 0186: a server migration, read as before and after.
--
-- Players of 577-588 are about to be allowed to move between servers. This
-- migration adds no new capture: it places what the collector already
-- writes on either side of one instant and says who went where.
--
-- WHO IS COUNTED. Not a server's population — nothing captures that. The
-- people this reads are the ones we observe: the cross-server power board
-- (`server.rank`, top 150) and the rosters of alliances someone opened
-- (`al.rank`). A server's "tracked" count is therefore a count of observed
-- people, and comparing two servers' tracked counts compares how often we
-- looked at them as much as anything else. The top-150 columns are the
-- like-for-like measure: it is one board, captured whole, on both sides.
--
-- WHAT A MOVE IS. `game_uid` survives a move (ADR 0001); `server_id` is the
-- subject's server as the response reports it. A person whose newest
-- observation before the event names one server and whose newest after it
-- names another has moved. Every board this reads carries an explicit
-- `serverId` per entry (checked in the journal 2026-09-27: server.rank
-- 150/150, al.rank 735/767 with the rest falling back to the UID suffix).
-- Whether that field names the NEW server after a move has not been seen
-- yet — nobody has moved. The first capture after the window opens must be
-- checked against a known mover before this board is believed.
--
-- THE TWO SIDES. An event has a `baseline_at` and, once the window has
-- closed and the after-sweep is in, a `settled_at`.
--   BEFORE = the newest observation at or before baseline_at, and no older
--            than 14 days (older than that says where somebody was, not
--            where they were when the window opened).
--   AFTER  = the newest observation after settled_at — or, while
--            settled_at is null, after baseline_at, so the board is live
--            during the window.
--
-- ALLIANCES ARE GROUPED BY THE GAME'S ID, NOT OURS. `alliances` is unique
-- on (server_id, external_id): an alliance that moves server comes back as
-- a second row with the same external_id. Everything here groups by
-- external_id so the two halves are read as one alliance.
--
-- Every function is security invoker: the snapshot tables are member-only
-- and their policies decide what a caller sees, exactly as for the boards
-- these are built from.

create table public.migration_events (
  event_id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  baseline_at timestamptz not null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint migration_events_settles_after_baseline
    check (settled_at is null or settled_at > baseline_at)
);

comment on table public.migration_events is
  'One server migration: the instant the before side is read at, and when '
  'the after side is settled (null while the window is open and the board '
  'reads live).';

alter table public.migration_events enable row level security;

grant select, insert, update, delete on public.migration_events to authenticated;
grant all on public.migration_events to service_role;

create policy member_read on public.migration_events
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create policy manager_insert on public.migration_events
  for insert to authenticated
  with check ((select public.has_permission('migration.manage')));
create policy manager_update on public.migration_events
  for update to authenticated
  using ((select public.has_permission('migration.manage')))
  with check ((select public.has_permission('migration.manage')));
create policy manager_delete on public.migration_events
  for delete to authenticated
  using ((select public.has_permission('migration.manage')));

-- Officers hold it, like hive.plan and data.enter: setting the two instants
-- is bookkeeping, and the window will not wait for an admin.
insert into public.capabilities (capability, label, description, sort_order) values
  ('migration.manage', 'Manage server migrations',
   'Add a server migration and set when its before and after sides are read.', 130);

insert into public.role_permissions (role, capability, allowed)
select r.role, 'migration.manage', r.role in ('officer', 'admin')
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role);

-- The rosters an event reads: per alliance (by the game's id), the newest
-- roster reading on each side. An alliance counts if it was read on either.
create function public.migration_roster_reads(p_event_id uuid)
returns table (
  external_id text,
  before_at timestamptz,
  after_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.baseline_at,
           e.baseline_at - interval '14 days' as stale_before,
           coalesce(e.settled_at, e.baseline_at) as after_from
      from public.migration_events e
     where e.event_id = p_event_id
  )
  select a.external_id, max(rb.before_at), max(ra.after_at)
    from ev
   cross join public.alliances a
   cross join lateral (
     select max(m.captured_at) as before_at
       from public.alliance_member_snapshots m
      where m.alliance_id = a.alliance_id
        and m.captured_at <= ev.baseline_at
        and m.captured_at > ev.stale_before
   ) rb
   cross join lateral (
     select max(m.captured_at) as after_at
       from public.alliance_member_snapshots m
      where m.alliance_id = a.alliance_id
        and m.captured_at > ev.after_from
   ) ra
   group by a.external_id
  having max(rb.before_at) is not null or max(ra.after_at) is not null;
$$;

-- One row per observed person: where they were, where they are, and what
-- that makes them. The building block for everything below. It can exceed
-- PostgREST's 1,000 rows once enough rosters are read, so no screen reads
-- it unfiltered — the summaries fold it server-side.
create function public.migration_people(p_event_id uuid)
returns table (
  game_uid bigint,
  player_id uuid,
  name text,
  home_server_id int,
  status text,
  before_server_id int,
  before_power bigint,
  before_alliance text,
  before_rank int,
  before_at timestamptz,
  after_server_id int,
  after_power bigint,
  after_alliance text,
  after_rank int,
  after_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.baseline_at,
           e.baseline_at - interval '14 days' as stale_before,
           coalesce(e.settled_at, e.baseline_at) as after_from
      from public.migration_events e
     where e.event_id = p_event_id
  ),
  -- The top-150 board is one response with one captured_at: the newest
  -- batch on each side is the board as it stood.
  board_at as (
    select
      (select max(s.captured_at)
         from public.player_snapshots s
        where s.source_command = 'server.rank'
          and s.captured_at <= ev.baseline_at
          and s.captured_at > ev.stale_before) as before_at,
      (select max(s.captured_at)
         from public.player_snapshots s
        where s.source_command = 'server.rank'
          and s.captured_at > ev.after_from) as after_at
    from ev
  ),
  board as (
    select s.player_id,
           min(s.rank) filter (where s.captured_at = b.before_at) as before_rank,
           min(s.rank) filter (where s.captured_at = b.after_at) as after_rank
      from board_at b
      join public.player_snapshots s
        on s.source_command = 'server.rank'
       and (s.captured_at = b.before_at or s.captured_at = b.after_at)
     group by s.player_id
  ),
  rosters as (
    select coalesce(m.player_id, p.player_id) as player_id
      from public.migration_roster_reads(p_event_id) r
      join public.alliances a on a.external_id = r.external_id
      join public.alliance_member_snapshots m
        on m.alliance_id = a.alliance_id
       and (m.captured_at = r.before_at or m.captured_at = r.after_at)
      left join public.players p on p.game_uid = m.game_uid
  ),
  people as (
    select u.player_id
      from (select b.player_id from board b
            union
            select r.player_id from rosters r) u
     where u.player_id is not null
  ),
  sides as (
    select
      pp.player_id,
      bp.server_id as bp_server, bp.power as bp_power, bp.name as bp_name,
      bp.abbr as bp_abbr, bp.captured_at as bp_at,
      bm.server_id as bm_server, bm.power as bm_power, bm.name as bm_name,
      bm.code as bm_code, bm.captured_at as bm_at,
      ap.server_id as ap_server, ap.power as ap_power, ap.name as ap_name,
      ap.abbr as ap_abbr, ap.captured_at as ap_at,
      am.server_id as am_server, am.power as am_power, am.name as am_name,
      am.code as am_code, am.captured_at as am_at
    from people pp
    cross join ev
    left join lateral (
      select s.server_id, s.power, s.name, nullif(s.raw ->> 'abbr', '') as abbr, s.captured_at
        from public.player_snapshots s
       where s.player_id = pp.player_id
         and s.captured_at <= ev.baseline_at
         and s.captured_at > ev.stale_before
       order by s.captured_at desc
       limit 1
    ) bp on true
    left join lateral (
      select m.server_id, m.power, m.name, a.current_code as code, m.captured_at
        from public.alliance_member_snapshots m
        join public.alliances a on a.alliance_id = m.alliance_id
       where m.player_id = pp.player_id
         and m.captured_at <= ev.baseline_at
         and m.captured_at > ev.stale_before
       order by m.captured_at desc
       limit 1
    ) bm on true
    left join lateral (
      select s.server_id, s.power, s.name, nullif(s.raw ->> 'abbr', '') as abbr, s.captured_at
        from public.player_snapshots s
       where s.player_id = pp.player_id
         and s.captured_at > ev.after_from
       order by s.captured_at desc
       limit 1
    ) ap on true
    left join lateral (
      select m.server_id, m.power, m.name, a.current_code as code, m.captured_at
        from public.alliance_member_snapshots m
        join public.alliances a on a.alliance_id = m.alliance_id
       where m.player_id = pp.player_id
         and m.captured_at > ev.after_from
       order by m.captured_at desc
       limit 1
    ) am on true
  ),
  -- Server, power and name come from whichever observation is newer. The
  -- alliance prefers the roster — it is the alliance's own list — and falls
  -- back to the abbreviation the power board prints next to the name.
  resolved as (
    select
      x.player_id,
      case when x.bm_at is not null and (x.bp_at is null or x.bm_at > x.bp_at)
           then x.bm_server else x.bp_server end as before_server_id,
      case when x.bm_at is not null and (x.bp_at is null or x.bm_at > x.bp_at)
           then x.bm_power else x.bp_power end as before_power,
      case when x.bm_at is not null and (x.bp_at is null or x.bm_at > x.bp_at)
           then x.bm_name else x.bp_name end as before_name,
      coalesce(x.bm_code, x.bp_abbr) as before_alliance,
      greatest(x.bp_at, x.bm_at) as before_at,
      case when x.am_at is not null and (x.ap_at is null or x.am_at > x.ap_at)
           then x.am_server else x.ap_server end as after_server_id,
      case when x.am_at is not null and (x.ap_at is null or x.am_at > x.ap_at)
           then x.am_power else x.ap_power end as after_power,
      case when x.am_at is not null and (x.ap_at is null or x.am_at > x.ap_at)
           then x.am_name else x.ap_name end as after_name,
      coalesce(x.am_code, x.ap_abbr) as after_alliance,
      greatest(x.ap_at, x.am_at) as after_at
    from sides x
  )
  select
    p.game_uid,
    r.player_id,
    coalesce(r.after_name, r.before_name, p.current_name),
    (p.game_uid % 1000000)::int,
    case
      when r.before_at is null then 'appeared'
      when r.after_at is null then 'unseen_after'
      when r.before_server_id <> r.after_server_id then 'moved'
      else 'stayed'
    end,
    r.before_server_id,
    r.before_power,
    r.before_alliance,
    b.before_rank,
    r.before_at,
    r.after_server_id,
    r.after_power,
    r.after_alliance,
    b.after_rank,
    r.after_at
  from resolved r
  join public.players p on p.player_id = r.player_id
  left join board b on b.player_id = r.player_id
  where r.before_at is not null or r.after_at is not null;
$$;

-- One row per server that appears on either side.
create function public.migration_servers(p_event_id uuid)
returns table (
  server_id int,
  tracked_before bigint,
  tracked_after bigint,
  stayed bigint,
  moved_out bigint,
  moved_in bigint,
  unseen_after bigint,
  appeared bigint,
  power_out bigint,
  power_in bigint,
  top_before bigint,
  top_after bigint,
  top_power_before bigint,
  top_power_after bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (select * from public.migration_people(p_event_id)),
  s as (
    select distinct u.server_id
      from p
     cross join lateral (values (p.before_server_id), (p.after_server_id)) as u(server_id)
     where u.server_id is not null
  )
  select
    s.server_id,
    count(*) filter (where p.before_server_id = s.server_id),
    count(*) filter (where p.after_server_id = s.server_id),
    count(*) filter (where p.status = 'stayed' and p.before_server_id = s.server_id),
    count(*) filter (where p.status = 'moved' and p.before_server_id = s.server_id),
    count(*) filter (where p.status = 'moved' and p.after_server_id = s.server_id),
    count(*) filter (where p.status = 'unseen_after' and p.before_server_id = s.server_id),
    count(*) filter (where p.status = 'appeared' and p.after_server_id = s.server_id),
    coalesce(sum(p.before_power) filter (
      where p.status = 'moved' and p.before_server_id = s.server_id), 0)::bigint,
    coalesce(sum(p.after_power) filter (
      where p.status = 'moved' and p.after_server_id = s.server_id), 0)::bigint,
    count(*) filter (where p.before_rank is not null and p.before_server_id = s.server_id),
    count(*) filter (where p.after_rank is not null and p.after_server_id = s.server_id),
    coalesce(sum(p.before_power) filter (
      where p.before_rank is not null and p.before_server_id = s.server_id), 0)::bigint,
    coalesce(sum(p.after_power) filter (
      where p.after_rank is not null and p.after_server_id = s.server_id), 0)::bigint
  from s
  cross join p
  group by s.server_id
  order by s.server_id;
$$;

-- One row per (from, to) pair somebody moved along.
create function public.migration_flows(p_event_id uuid)
returns table (
  from_server_id int,
  to_server_id int,
  movers bigint,
  top_movers bigint,
  power bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.before_server_id, p.after_server_id, count(*),
         count(*) filter (where p.before_rank is not null or p.after_rank is not null),
         coalesce(sum(coalesce(p.after_power, p.before_power)), 0)::bigint
    from public.migration_people(p_event_id) p
   where p.status = 'moved'
   group by p.before_server_id, p.after_server_id
   order by p.before_server_id, p.after_server_id;
$$;

-- Everybody on the top-150 board on either side: at most 300 rows.
create function public.migration_top_board(p_event_id uuid)
returns table (
  game_uid bigint,
  player_id uuid,
  name text,
  home_server_id int,
  status text,
  before_server_id int,
  before_power bigint,
  before_alliance text,
  before_rank int,
  before_at timestamptz,
  after_server_id int,
  after_power bigint,
  after_alliance text,
  after_rank int,
  after_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
    from public.migration_people(p_event_id) p
   where p.before_rank is not null or p.after_rank is not null
   order by coalesce(p.before_rank, 1000), coalesce(p.after_rank, 1000);
$$;

-- One row per observed alliance, by the game's id. Membership comes from the
-- rosters (only alliances somebody opened); power and member count also come
-- from the alliance boards, which cover the top alliances of every server.
create function public.migration_alliances(p_event_id uuid)
returns table (
  external_id text,
  name text,
  code text,
  before_server_id int,
  after_server_id int,
  roster_before_at timestamptz,
  roster_after_at timestamptz,
  members_before bigint,
  members_after bigint,
  roster_power_before bigint,
  roster_power_after bigint,
  stayed bigint,
  left_alliance bigint,
  left_by_moving bigint,
  joined bigint,
  board_power_before bigint,
  board_power_after bigint,
  board_members_before int,
  board_members_after int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.baseline_at,
           e.baseline_at - interval '14 days' as stale_before,
           coalesce(e.settled_at, e.baseline_at) as after_from
      from public.migration_events e
     where e.event_id = p_event_id
  ),
  reads as (select * from public.migration_roster_reads(p_event_id)),
  members as (
    select r.external_id, m.game_uid, m.power,
           m.captured_at = r.before_at as is_before,
           a.server_id
      from reads r
      join public.alliances a on a.external_id = r.external_id
      join public.alliance_member_snapshots m
        on m.alliance_id = a.alliance_id
       and (m.captured_at = r.before_at or m.captured_at = r.after_at)
  ),
  roster as (
    select r.external_id, r.before_at, r.after_at,
           count(*) filter (where m.is_before) as members_before,
           count(*) filter (where not m.is_before) as members_after,
           sum(m.power) filter (where m.is_before) as power_before,
           sum(m.power) filter (where not m.is_before) as power_after,
           mode() within group (order by m.server_id) filter (where m.is_before) as server_before,
           mode() within group (order by m.server_id) filter (where not m.is_before) as server_after
      from reads r
      left join members m on m.external_id = r.external_id
     group by r.external_id, r.before_at, r.after_at
  ),
  people as (select * from public.migration_people(p_event_id)),
  -- Who of the before roster is still on the after roster, and of those who
  -- are not, how many left by leaving the server rather than the alliance.
  churn as (
    select b.external_id,
           count(*) filter (where a.game_uid is not null) as stayed,
           count(*) filter (where a.game_uid is null) as left_alliance,
           count(*) filter (where a.game_uid is null and pe.status = 'moved') as left_by_moving
      from members b
      join reads r on r.external_id = b.external_id and r.after_at is not null
      left join members a
        on a.external_id = b.external_id and not a.is_before and a.game_uid = b.game_uid
      left join people pe on pe.game_uid = b.game_uid
     where b.is_before
     group by b.external_id
  ),
  joined as (
    select r.external_id, count(*) as joined
      from reads r
      join members a on a.external_id = r.external_id and not a.is_before
     where r.before_at is not null
       and not exists (
         select 1 from members b
          where b.external_id = r.external_id and b.is_before and b.game_uid = a.game_uid)
     group by r.external_id
  ),
  board_ids as (
    select distinct s.external_id
      from ev
      join public.alliance_snapshots s
        on s.captured_at > ev.stale_before
   where s.captured_at <= ev.baseline_at or s.captured_at > ev.after_from
  ),
  ids as (
    select external_id from reads
    union
    select external_id from board_ids
  )
  select
    i.external_id,
    coalesce(na.name, nb.name, al.current_name),
    coalesce(na.code, nb.code, al.current_code),
    coalesce(ro.server_before, nb.server_id),
    coalesce(ro.server_after, na.server_id),
    ro.before_at,
    ro.after_at,
    case when ro.before_at is not null then ro.members_before end,
    case when ro.after_at is not null then ro.members_after end,
    ro.power_before::bigint,
    ro.power_after::bigint,
    case when ro.before_at is not null and ro.after_at is not null then coalesce(ch.stayed, 0) end,
    case when ro.before_at is not null and ro.after_at is not null then coalesce(ch.left_alliance, 0) end,
    case when ro.before_at is not null and ro.after_at is not null then coalesce(ch.left_by_moving, 0) end,
    case when ro.before_at is not null and ro.after_at is not null then coalesce(jn.joined, 0) end,
    nb.power,
    na.power,
    nb.member_count,
    na.member_count
  from ids i
  cross join ev
  left join roster ro on ro.external_id = i.external_id
  left join churn ch on ch.external_id = i.external_id
  left join joined jn on jn.external_id = i.external_id
  left join lateral (
    select s.name, s.code, s.power, s.member_count, s.server_id
      from public.alliance_snapshots s
     where s.external_id = i.external_id
       and s.captured_at <= ev.baseline_at
       and s.captured_at > ev.stale_before
     order by s.captured_at desc
     limit 1
  ) nb on true
  left join lateral (
    select s.name, s.code, s.power, s.member_count, s.server_id
      from public.alliance_snapshots s
     where s.external_id = i.external_id
       and s.captured_at > ev.after_from
     order by s.captured_at desc
     limit 1
  ) na on true
  left join lateral (
    select a.current_name, a.current_code
      from public.alliances a
     where a.external_id = i.external_id
     order by a.last_seen_at desc nulls last
     limit 1
  ) al on true
  order by coalesce(na.power, nb.power, ro.power_after, ro.power_before) desc nulls last;
$$;

-- Postgres grants EXECUTE to PUBLIC at creation. Revoke it, as every gated
-- function here does, so the answer to anon is a refusal and not a reliance
-- on the table grants underneath.
revoke execute on function public.migration_roster_reads(uuid) from public, anon;
revoke execute on function public.migration_people(uuid) from public, anon;
revoke execute on function public.migration_servers(uuid) from public, anon;
revoke execute on function public.migration_flows(uuid) from public, anon;
revoke execute on function public.migration_top_board(uuid) from public, anon;
revoke execute on function public.migration_alliances(uuid) from public, anon;

grant execute on function public.migration_roster_reads(uuid) to authenticated, service_role;
grant execute on function public.migration_people(uuid) to authenticated, service_role;
grant execute on function public.migration_servers(uuid) to authenticated, service_role;
grant execute on function public.migration_flows(uuid) to authenticated, service_role;
grant execute on function public.migration_top_board(uuid) to authenticated, service_role;
grant execute on function public.migration_alliances(uuid) to authenticated, service_role;
