-- 0191: the migration board is for officers, and reads the prefix it is allowed to.
--
-- 0186's migration_people is security invoker and read the prefix as
-- `raw ->> 'abbr'`. Members are not granted `raw` — 0016 closed it because
-- the month pass rides in it — so every signed-in call failed with
-- "permission denied for table player_snapshots", and with it every summary
-- built on it (servers, flows, top board, alliances). The board worked for
-- service_role and for nobody on the dashboard.
--
-- server.rank carries the prefix only in `raw` (its normalizer leaves
-- alliance_external_id null; the response has no alliance id), so it is
-- promoted here as a generated column: nothing writes it, every existing row
-- gets it from the rewrite, and it is granted on its own, like the columns
-- 0016 listed. `raw` stays closed.
--
-- Adding a stored generated column rewrites player_snapshots under an
-- exclusive lock; sync's inserts wait for it.

alter table public.player_snapshots
  add column alliance_abbr text generated always as (nullif(raw ->> 'abbr', '')) stored;

comment on column public.player_snapshots.alliance_abbr is
  'The alliance prefix printed beside the name on the board this row came '
  'from (raw.abbr). Null where the response carries none.';

grant select (alliance_abbr) on public.player_snapshots to authenticated;

-- One row per observed person: where they were, where they are, and what
-- that makes them. The building block for everything below. It can exceed
-- PostgREST's 1,000 rows once enough rosters are read, so no screen reads
-- it unfiltered — the summaries fold it server-side.
create or replace function public.migration_people(p_event_id uuid)
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
      select s.server_id, s.power, s.name, s.alliance_abbr as abbr, s.captured_at
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
      select s.server_id, s.power, s.name, s.alliance_abbr as abbr, s.captured_at
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

-- The board is for officers and admins.
--
-- 0186 opened migration_events to members and read everything else as the
-- caller, assuming the snapshots underneath were member-only. The rosters
-- are not: 0066 made alliance_member_snapshots own-or-officer, so a member
-- was handed the power board's people and silently none of the roster's —
-- a board that looks complete and is not. Rather than widen 0066 through a
-- definer, the board is drawn at the same line the rosters are.
--
-- Every function here starts from migration_events, so closing its read
-- closes the board: a member's call returns no rows rather than a partial
-- set. Enumerated roles, not a capability, for 0066's reason — this is a
-- property of the data, not a switch on the settings grid.
drop policy member_read on public.migration_events;

create policy officer_read on public.migration_events
  for select to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));
