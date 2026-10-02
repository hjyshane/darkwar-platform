-- 0204: who took part, per member, over a season, a week or a duel round.
--
-- Asked for on 2026-10-02: one report of every member's participation across
-- the events the alliance runs. Two kinds of source feed it, and they are
-- kept apart on purpose.
--
-- CAPTURED. Alliance Duel and donations (alliance_contribution_snapshots),
-- Black Gold (black_money_battle_members, 0181) and season buildings
-- (season_building_snapshots, 0138). Nothing new is collected here; the
-- function below only folds what is already there.
--
-- TYPED. Capital Clash, Server Clash, Frankie, Ice Pit and Furnace Fury have
-- never been captured (docs/capture-backlog.md §5: event rankings need a
-- capture while the event runs). Until they are, an officer ticks who took
-- part. That is NOT the event framework CLAUDE.md defers (§13): no protocol
-- field is guessed at. A row says "this officer recorded this member as
-- present or absent on this day", which is true whatever the game's payload
-- turns out to hold. When an event is captured, its kind is flipped to
-- `captured` and its reader added beside the others; the typed rows stay as
-- the record of the days nobody captured.
--
-- ABSENT IS NOT ZERO (0071, 0157). A member with no reading on a day the
-- board was never opened has not scored nothing; they have not been read.
-- So every captured figure comes with the count of days or weeks the board
-- WAS read for the alliance, and the member's own count of readings. A day
-- the board was read and the member is not on it is reported as exactly
-- that — not on the board — and the screen decides how to say it.
--
-- ONE ROW PER MEMBER (CLAUDE.md). A season of daily readings is tens of
-- thousands of rows and PostgREST stops at 1,000 without saying so; folded
-- here, the answer is the size of the roster.

-- ---------------------------------------------------------------------------
-- The events an officer can record. A table, not a CHECK, so the next one is
-- an insert rather than a constraint swap — but still written by migration:
-- a kind is a promise that the report has a column for it.

create table public.attendance_event_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  sort_order int not null default 0,
  -- False while the only source is an officer's tick. See the header.
  captured boolean not null default false
);

comment on table public.attendance_event_kinds is
  'Events whose attendance an officer records by hand (0204), in the order '
  'the participation report shows them. `captured` turns true once the event '
  'has a collector writer of its own.';

insert into public.attendance_event_kinds (kind, label, sort_order) values
  ('capital_clash', 'Capital Clash', 10),
  ('server_clash', 'Server Clash', 20),
  ('frankie', 'Frankie', 30),
  ('ice_pit', 'Ice Pit', 40),
  ('furnace_fury', 'Furnace Fury', 50);

alter table public.attendance_event_kinds enable row level security;
revoke all on public.attendance_event_kinds from anon;
grant select on public.attendance_event_kinds to authenticated;
grant all on public.attendance_event_kinds to service_role;

create policy member_read on public.attendance_event_kinds
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- ---------------------------------------------------------------------------
-- One member, one event, one day: there or not.

create table public.event_attendance (
  -- NULL means primary, as everywhere since 0194.
  alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  kind text not null references public.attendance_event_kinds (kind),
  -- The GAME day (resets 02:00 UTC). A date, not an instant: an officer
  -- knows which day Capital Clash was, not the second it ended.
  held_on date not null,
  player_id uuid not null references public.players (player_id) on delete cascade,
  attended boolean not null,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  constraint event_attendance_key
    unique nulls not distinct (alliance_id, kind, held_on, player_id)
);

create index event_attendance_report_idx
  on public.event_attendance (alliance_id, held_on);

comment on table public.event_attendance is
  'Typed attendance for events nobody captures (0204): one row per member per '
  'event day, attended or not. No row means not recorded, never absent. '
  'Written only through record_event_attendance.';

alter table public.event_attendance enable row level security;
revoke all on public.event_attendance from anon;
-- Read only. Every write goes through the function below, which checks the
-- capability and stamps the alliance; a direct insert could do neither.
grant select on public.event_attendance to authenticated;
grant all on public.event_attendance to service_role;

create policy member_read on public.event_attendance
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create policy alliance_scope on public.event_attendance as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

-- Record one event day, many members at once.
--
-- p_entries: [{ "player_id": uuid, "attended": boolean|null }]
-- true / false records the member; null takes their row away (a tick made by
-- mistake). Re-recording a member replaces their row. Returns rows touched.
--
-- data.enter, the capability 0176 gave officers for typing in what the
-- collector could not see. Same people, same reason.
create function public.record_event_attendance(p_kind text, p_held_on date, p_entries jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_missing uuid;
  v_written int;
  v_removed int;
begin
  if not public.has_permission('data.enter') then
    raise exception 'recording attendance requires the data.enter permission'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.attendance_event_kinds where kind = p_kind) then
    raise exception 'there is no event called %', p_kind using errcode = '22023';
  end if;
  if p_held_on is null then
    raise exception 'the day the event was held is required' using errcode = '22023';
  end if;
  -- Today on the game clock is the latest an event can have been held.
  if p_held_on > (now() at time zone 'UTC' - interval '2 hours')::date then
    raise exception 'that day has not happened yet' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'the entries must be a json array of {player_id, attended} objects'
      using errcode = '22023';
  end if;
  select e.player_id into v_missing
    from jsonb_to_recordset(p_entries) as e(player_id uuid)
   group by e.player_id having count(*) > 1
   limit 1;
  if found then
    raise exception 'player % appears more than once', v_missing using errcode = '23505';
  end if;
  select e.player_id into v_missing
    from jsonb_to_recordset(p_entries) as e(player_id uuid)
    left join public.players p on p.player_id = e.player_id
   where p.player_id is null
   limit 1;
  if found then
    raise exception 'player % is not one the collector has ever seen', v_missing
      using errcode = '23503';
  end if;

  delete from public.event_attendance a
   using jsonb_to_recordset(p_entries) as e(player_id uuid, attended boolean)
   where e.attended is null
     and a.player_id = e.player_id
     and a.kind = p_kind
     and a.held_on = p_held_on
     and a.alliance_id is not distinct from v_alliance;
  get diagnostics v_removed = row_count;

  insert into public.event_attendance
    (alliance_id, kind, held_on, player_id, attended, entered_by, entered_at)
  select v_alliance, p_kind, p_held_on, e.player_id, e.attended, auth.uid(), now()
    from jsonb_to_recordset(p_entries) as e(player_id uuid, attended boolean)
   where e.attended is not null
  on conflict on constraint event_attendance_key do update
    set attended = excluded.attended,
        entered_by = excluded.entered_by,
        entered_at = excluded.entered_at;
  get diagnostics v_written = row_count;

  return v_written + v_removed;
end;
$$;

comment on function public.record_event_attendance(text, date, jsonb) is
  'Record who took part in one uncaptured event on one game day, for the '
  'alliance being viewed. attended null removes the member''s row. data.enter.';

revoke all on function public.record_event_attendance(text, date, jsonb) from public, anon;
grant execute on function public.record_event_attendance(text, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The report.
--
-- [p_from, p_to) in game time. A week or a day counts when it STARTS inside
-- the range, so a season, a round and a week all fold the same way and no
-- day is counted in two adjacent ranges.
--
-- THE WINDOWS are every other reader's: the newest reading inside a game day
-- (02:00 UTC to the minute before the next) or a game week (0050's week
-- ends). Those boards accumulate and reset, so the newest reading IS the
-- total. Typed and derived weekly duel rows are included, because the rank
-- counts them (0176, 0184); the daily boards have neither.
--
-- "READ" is per alliance: a day counts as read when the board has a reading
-- for ANY current member that day. On a read day a member with no reading
-- is "not on the board". On a day nobody read, nobody is anything.
--
-- SEASON BUILDINGS are levels gained: per building (object_id, the id 0138
-- calls stable across days, with its type), the highest level seen
-- in the range less the last level seen before it (or the first seen inside
-- it, for a building first sighted in the range). Map sweeps are occasional,
-- so this is a floor, and the column says "seen".
--
-- Security invoker: member_roster_current's alliance_scope (0196) narrows the
-- roster to the alliance being viewed, and anyone who may not read the
-- snapshots gets nothing.
create function public.member_participation(p_from timestamptz, p_to timestamptz)
returns table (
  player_id uuid,
  current_name text,
  game_uid bigint,
  member_rank int,
  duel_days_read int,
  duel_days_on_board int,
  duel_days_scored int,
  duel_weeks_read int,
  duel_weeks_on_board int,
  duel_weeks_scored int,
  duel_total bigint,
  donation_days_read int,
  donation_days_on_board int,
  donation_days_scored int,
  donation_weeks_read int,
  donation_weeks_on_board int,
  donation_weeks_scored int,
  donation_total bigint,
  black_gold_listed int,
  black_gold_played int,
  black_gold_starter_missed int,
  black_gold_substitute_missed int,
  season_levels_gained int,
  typed_events jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  bounds as (
    select
      p_from as f,
      p_to as t,
      -- The first and last GAME dates in the range, for the typed rows.
      ((p_from at time zone 'UTC') - interval '2 hours')::date as first_day,
      ((p_to at time zone 'UTC') - interval '2 hours')::date as end_day
    where p_from is not null
      and p_to is not null
      and p_to > p_from
      -- A season is a handful of duel rounds; half a year is the most anybody
      -- should ask for in one call, and it keeps the probes below bounded.
      and p_to - p_from <= interval '190 days'
  ),
  members as (
    select r.player_id, p.current_name, p.game_uid, r.member_rank
      from public.member_roster_current r
      join public.players p on p.player_id = r.player_id
  ),
  days as (
    select d as day_start
      from bounds b,
           generate_series(
             -- In UTC whatever the session's zone: the game day is a UTC rule.
             date_trunc('day', b.f - interval '2 hours', 'UTC') + interval '2 hours',
             b.t - interval '1 second', interval '1 day') as d
     where d >= b.f and d < b.t
  ),
  weeks as (
    select w as week_start
      from bounds b,
           generate_series(public.reset_week_start(b.f), b.t - interval '1 second',
                           interval '7 days') as w
     where w >= b.f and w < b.t
  ),
  boards as (
    select * from (values
      ('duel', 'alliance_battle_daily', 'alliance_battle_weekly'),
      ('donation', 'daily_donation', 'weekly_donation')
    ) as v(board, daily_kind, weekly_kind)
  ),
  daily as (
    select m.player_id, bd.board, d.day_start, x.score
      from members m
      cross join boards bd
      cross join days d
      left join lateral (
        select s.score
          from public.alliance_contribution_snapshots s
         where s.game_uid = m.game_uid
           and s.contribution_type = bd.daily_kind
           and s.captured_at > d.day_start
           and s.captured_at <= d.day_start + interval '1 day' - interval '1 minute'
         order by s.captured_at desc
         limit 1
      ) x on true
  ),
  weekly as (
    select m.player_id, bd.board, w.week_start, x.score
      from members m
      cross join boards bd
      cross join weeks w
      left join lateral (
        select s.score
          from public.alliance_contribution_snapshots s
         where s.game_uid = m.game_uid
           and s.contribution_type = bd.weekly_kind
           and s.captured_at > w.week_start
           and s.captured_at <= w.week_start + interval '7 days' - interval '1 minute'
         order by s.captured_at desc
         limit 1
      ) x on true
  ),
  days_read as (
    select board, day_start from daily where score is not null group by board, day_start
  ),
  weeks_read as (
    select board, week_start from weekly where score is not null group by board, week_start
  ),
  daily_folded as (
    select
      d.player_id, d.board,
      count(*) filter (where d.score is not null)::int as on_board,
      count(*) filter (where d.score > 0)::int as scored
    from daily d
    group by d.player_id, d.board
  ),
  weekly_folded as (
    select
      w.player_id, w.board,
      count(*) filter (where w.score is not null)::int as on_board,
      count(*) filter (where w.score > 0)::int as scored,
      sum(w.score)::bigint as total
    from weekly w
    group by w.player_id, w.board
  ),
  black_gold as (
    select
      bm.game_uid,
      count(*) filter (where bm.slot is not null)::int as listed,
      count(*) filter (where bm.played)::int as played,
      count(*) filter (where bm.slot = 'starter' and bm.played = false)::int as starter_missed,
      count(*) filter (where bm.slot = 'substitute' and bm.played = false)::int as substitute_missed
    from public.black_money_battle_members bm
    join public.black_money_battles bb
      on bb.alliance_external_id = bm.alliance_external_id
     and bb.battle_ended_at = bm.battle_ended_at
     and bb.team_index = bm.team_index
    cross join bounds b
    where bm.battle_ended_at >= b.f
      and bm.battle_ended_at < b.t
      -- A battle without a captured report says nothing about anybody (0183).
      and bm.played is not null
      and coalesce(bb.alliance_id, (select public.primary_own_alliance()))
          is not distinct from (select public.active_alliance())
    group by bm.game_uid
  ),
  buildings as (
    select
      m.player_id,
      sum(greatest(0, inside.top - coalesce(before.level, inside.first_level)))::int as gained
    from members m
    cross join bounds b
    join lateral (
      select
        s.object_id,
        s.building_type_id,
        max(s.level) as top,
        (array_agg(s.level order by s.captured_at))[1] as first_level
      from public.season_building_snapshots s
      where s.game_uid = m.game_uid
        and s.level is not null
        and s.captured_at >= b.f
        and s.captured_at < b.t
      group by s.object_id, s.building_type_id
    ) inside on true
    left join lateral (
      select s.level
        from public.season_building_snapshots s
       where s.game_uid = m.game_uid
         and s.object_id is not distinct from inside.object_id
         and s.building_type_id is not distinct from inside.building_type_id
         and s.level is not null
         and s.captured_at < b.f
       order by s.captured_at desc
       limit 1
    ) before on true
    group by m.player_id
  ),
  typed_held as (
    select a.kind, count(distinct a.held_on)::int as held
      from public.event_attendance a
      cross join bounds b
     where a.held_on >= b.first_day
       and a.held_on < b.end_day
     group by a.kind
  ),
  typed_member as (
    select
      a.player_id, a.kind,
      count(*) filter (where a.attended)::int as attended,
      count(*) filter (where not a.attended)::int as missed
    from public.event_attendance a
    cross join bounds b
    where a.held_on >= b.first_day
      and a.held_on < b.end_day
    group by a.player_id, a.kind
  ),
  typed_folded as (
    -- Every event held in the range, for every member, so a member nobody
    -- ticked reads as "not recorded" (attended 0, missed 0 of held N) rather
    -- than vanishing from the column.
    select
      m.player_id,
      jsonb_object_agg(
        h.kind,
        jsonb_build_object(
          'held', h.held,
          'attended', coalesce(tm.attended, 0),
          'missed', coalesce(tm.missed, 0))
      ) as events
    from members m
    cross join typed_held h
    left join typed_member tm on tm.player_id = m.player_id and tm.kind = h.kind
    group by m.player_id
  )
  select
    m.player_id,
    m.current_name,
    m.game_uid,
    m.member_rank::int,
    (select count(*)::int from days_read r where r.board = 'duel'),
    coalesce(dd.on_board, 0),
    coalesce(dd.scored, 0),
    (select count(*)::int from weeks_read r where r.board = 'duel'),
    coalesce(wd.on_board, 0),
    coalesce(wd.scored, 0),
    wd.total,
    (select count(*)::int from days_read r where r.board = 'donation'),
    coalesce(dg.on_board, 0),
    coalesce(dg.scored, 0),
    (select count(*)::int from weeks_read r where r.board = 'donation'),
    coalesce(wg.on_board, 0),
    coalesce(wg.scored, 0),
    wg.total,
    coalesce(bg.listed, 0),
    coalesce(bg.played, 0),
    coalesce(bg.starter_missed, 0),
    coalesce(bg.substitute_missed, 0),
    sb.gained,
    coalesce(tf.events, '{}'::jsonb)
  from members m
  cross join bounds b
  left join daily_folded dd on dd.player_id = m.player_id and dd.board = 'duel'
  left join weekly_folded wd on wd.player_id = m.player_id and wd.board = 'duel'
  left join daily_folded dg on dg.player_id = m.player_id and dg.board = 'donation'
  left join weekly_folded wg on wg.player_id = m.player_id and wg.board = 'donation'
  left join black_gold bg on bg.game_uid = m.game_uid
  left join buildings sb on sb.player_id = m.player_id
  left join typed_folded tf on tf.player_id = m.player_id
  -- A bad range has no `bounds` row, so the cross join returns nothing
  -- rather than a misleading row of zeroes.
  order by m.current_name;
$$;

comment on function public.member_participation(timestamptz, timestamptz) is
  'One row per current member of the alliance being viewed: duel and '
  'donation days/weeks on the board out of the days/weeks the board was read, '
  'Black Gold listings and misses, season building levels seen gained, and '
  'typed attendance per uncaptured event, for game time [p_from, p_to). '
  'Ranges over 190 days return nothing. 0204.';

revoke all on function public.member_participation(timestamptz, timestamptz) from public, anon;
grant execute on function public.member_participation(timestamptz, timestamptz) to authenticated;
