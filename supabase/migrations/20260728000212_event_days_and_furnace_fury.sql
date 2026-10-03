-- 0212: the days each event was held, and Furnace Fury from its own board.
--
-- FURNACE FURY IS CAPTURED. Its member board (`al.fight.act.member.score`)
-- lists every member of the alliance who fought, with a score: the
-- participation list itself. normalize/furnace_fury.py writes one row per
-- member per read, dated by the game day it was read on. Checked on
-- 2026-10-03 against the days the user named (09-08, 09-15, 09-22, 09-29):
-- the board was read on exactly 09-15, 09-22 and 09-29, and 09-29's 23 rows
-- match that battle's `fightMember` 23. 09-08 predates the journal and stays
-- typed. On a day with a captured board, a member on it was there and a
-- member missing from it was not; an officer's tick still overrides.
--
-- HELD DAYS ARE DECLARED. Until now an event was "held" on a day only if an
-- officer had ticked somebody for it, so an event nobody had typed up yet was
-- invisible: not "nobody recorded" but "never happened". The days the user
-- gave on 2026-10-03 are written here; a tick or a captured board on another
-- day still counts. Ice Pit's come from the game itself: activity 41101's
-- `icecave_opentime` '1;1;720|2;3;720|3;5;720' (Lv1 Monday, Lv2 Wednesday,
-- Lv3 Friday at 12:00 server time) over `activity_opentime` '3-7;3', season
-- weeks 3 to 7 from the 08-17 start: 08-31 to 10-02.
--
-- Zombie Siege is deliberately absent: the user ruled it out of the board.

create table public.furnace_fury_scores (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- The member's server, from the uid.
  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  -- The alliance whose board it is.
  alliance_id uuid references public.alliances (alliance_id),
  alliance_external_id text not null,
  -- The game day the board was read on: the battle has no id or time.
  held_on date not null,
  attacker boolean,
  score bigint
);

create index furnace_fury_scores_alliance_day_idx
  on public.furnace_fury_scores (alliance_id, held_on, game_uid);

comment on table public.furnace_fury_scores is
  'Furnace Fury member boards (al.fight.act.member.score, 0212): one row per '
  'member per distinct read. On the board = fought that day.';

alter table public.furnace_fury_scores enable row level security;
-- revoke-then-grant: hosted default privileges give authenticated all (0207).
revoke all on public.furnace_fury_scores from anon, authenticated;
grant select on public.furnace_fury_scores to authenticated;
grant all on public.furnace_fury_scores to service_role;

create policy member_read on public.furnace_fury_scores
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

update public.attendance_event_kinds set captured = true where kind = 'furnace_fury';
update public.attendance_event_kinds set label = 'Bio-Mutant' where kind = 'frankie';

-- ---------------------------------------------------------------------------

create table public.attendance_event_days (
  -- NULL means primary, as on event_attendance.
  alliance_id uuid references public.alliances (alliance_id) on delete cascade,
  kind text not null references public.attendance_event_kinds (kind),
  held_on date not null,
  note text check (note is null or length(note) <= 200),
  constraint attendance_event_days_key unique nulls not distinct (alliance_id, kind, held_on)
);

comment on table public.attendance_event_days is
  'Game days each event was held (0212), whether or not anybody has recorded '
  'who took part. The report counts these as held; a tick or a captured board '
  'on another day counts too.';

alter table public.attendance_event_days enable row level security;
revoke all on public.attendance_event_days from anon, authenticated;
grant select on public.attendance_event_days to authenticated;
grant all on public.attendance_event_days to service_role;

create policy member_read on public.attendance_event_days
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create policy alliance_scope on public.attendance_event_days as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()));

insert into public.attendance_event_days (kind, held_on, note) values
  ('furnace_fury', '2026-09-08', null),
  ('furnace_fury', '2026-09-15', null),
  ('furnace_fury', '2026-09-22', null),
  ('furnace_fury', '2026-09-29', null),
  ('capital_clash', '2026-09-19', null),
  ('server_clash', '2026-09-05',
   'Capital defence after losing the 08-31 to 09-04 server contest; lost'),
  ('frankie', '2026-10-02', null);

insert into public.attendance_event_days (kind, held_on, note)
select 'ice_pit', d::date,
       'Lv' || case extract(isodow from d) when 1 then 1 when 3 then 2 else 3 end
  from generate_series(date '2026-08-31', date '2026-10-02', interval '1 day') as d
 where extract(isodow from d) in (1, 3, 5);

-- ---------------------------------------------------------------------------
-- The report, with the held days and Furnace Fury's board. Everything above
-- the furnace_fought CTE is 0204's body unchanged.

create or replace function public.member_participation(p_from timestamptz, p_to timestamptz)
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
  -- Furnace Fury days with this alliance's member board captured (0212).
  furnace_fought as (
    select distinct s.game_uid, s.held_on
      from public.furnace_fury_scores s
      cross join bounds b
     where s.held_on >= b.first_day and s.held_on < b.end_day
       and s.alliance_id = (select public.active_alliance())
  ),
  furnace_boards as (
    select distinct f.held_on from furnace_fought f
  ),
  -- Every day each event was held in the range: declared (0212), ticked by
  -- an officer, or captured. Each is enough on its own.
  event_days as (
    select d.kind, d.held_on
      from public.attendance_event_days d
      cross join bounds b
     where d.held_on >= b.first_day and d.held_on < b.end_day
    union
    select a.kind, a.held_on
      from public.event_attendance a
      cross join bounds b
     where a.held_on >= b.first_day and a.held_on < b.end_day
    union
    select 'furnace_fury', f.held_on
      from furnace_boards f
  ),
  typed_held as (
    select e.kind, count(*)::int as held
      from event_days e
     group by e.kind
  ),
  -- One verdict per member per event day. An officer's tick wins: it is a
  -- person correcting the record. Otherwise a captured board decides: on it
  -- is present, missing from it is absent. Otherwise nothing is known.
  verdicts as (
    select
      m.player_id, e.kind, e.held_on,
      coalesce(
        a.attended,
        case
          when fb.held_on is not null then ff.game_uid is not null
        end) as attended
    from members m
    cross join event_days e
    left join public.event_attendance a
      on a.player_id = m.player_id and a.kind = e.kind and a.held_on = e.held_on
    left join furnace_boards fb
      on e.kind = 'furnace_fury' and fb.held_on = e.held_on
    left join furnace_fought ff
      on e.kind = 'furnace_fury' and ff.held_on = e.held_on and ff.game_uid = m.game_uid
  ),
  typed_member as (
    select
      v.player_id, v.kind,
      count(*) filter (where v.attended)::int as attended,
      count(*) filter (where not v.attended)::int as missed
    from verdicts v
    group by v.player_id, v.kind
  ),
  typed_folded as (
    -- Every event held in the range, for every member, so a member nobody
    -- recorded reads as "not recorded" (attended 0, missed 0 of held N)
    -- rather than vanishing from the column.
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
  'per-event attendance over the days each event was held (declared, ticked '
  'or captured; Furnace Fury from its board), for game time [p_from, p_to). '
  'Ranges over 190 days return nothing. 0204, 0212.';
