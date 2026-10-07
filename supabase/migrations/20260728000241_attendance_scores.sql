-- 0241: an optional score on a manual attendance row, and the report's totals.
--
-- Asked for on 2026-10-07: when an officer types who took part in an event, an
-- optional score box beside the tick -- and the events the collector does read
-- (Furnace Fury) already have a score on their board.
--
--   * event_attendance.score: whole number, 0 or more, null = none typed.
--   * record_event_attendance takes an optional "score" on each entry. Left
--     out it keeps the stored score (so correcting a tick does not wipe a
--     score); null clears it; a number sets it. A score only rides with a tick:
--     clearing the tick removes the row and its score with it.
--   * member_participation's per-event tally gains "score": the member's total
--     over the event's held days in the range, a typed score beating a scanned
--     one for the same day, null when no day has one. The return type is
--     unchanged (typed_events is jsonb), so CREATE OR REPLACE keeps the grants.

alter table public.event_attendance
  add column score bigint check (score is null or score >= 0);

comment on column public.event_attendance.score is
  'What the member scored in the event that day, when an officer typed it (0241). '
  'Null is not recorded, never zero.';

create or replace function public.record_event_attendance(p_kind text, p_held_on date, p_entries jsonb)
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
  -- A score is optional: a whole number of 0 or more, or null to clear one.
  if exists (
    select 1 from jsonb_array_elements(p_entries) as e
     where e ? 'score'
       and jsonb_typeof(e -> 'score') <> 'null'
       and (jsonb_typeof(e -> 'score') <> 'number' or (e ->> 'score') !~ '^[0-9]{1,15}$')
  ) then
    raise exception 'a score is a whole number, 0 or more' using errcode = '22023';
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
    (alliance_id, kind, held_on, player_id, attended, entered_by, entered_at, score)
  select v_alliance, p_kind, p_held_on, e.player_id, e.attended, auth.uid(), now(), e.score
    from jsonb_to_recordset(p_entries) as e(player_id uuid, attended boolean, score bigint)
   where e.attended is not null
  -- The score is NOT touched here: an entry that does not mention one must
  -- leave the stored score alone, and a recordset cannot tell "left out" from
  -- "null". The update below is what sets or clears it.
  on conflict on constraint event_attendance_key do update
    set attended = excluded.attended,
        entered_by = excluded.entered_by,
        entered_at = excluded.entered_at;
  get diagnostics v_written = row_count;

  -- Entries that name a score set it (null clears it); entries that do not
  -- keep what is stored.
  update public.event_attendance a
     set score = nullif(e ->> 'score', '')::bigint
    from jsonb_array_elements(p_entries) as e
   where e ? 'score'
     and e ->> 'attended' is not null
     and a.player_id = (e ->> 'player_id')::uuid
     and a.kind = p_kind
     and a.held_on = p_held_on
     and a.alliance_id is not distinct from v_alliance;

  return v_written + v_removed;
end;
$$;
create or replace function public.member_participation(
  p_from timestamptz,
  p_to timestamptz,
  p_duel_min bigint default null,
  p_donation_min bigint default null
)
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
  watchtower_level int,
  watchtower_gained int,
  typed_events jsonb,
  duel_days_over int,
  donation_days_over int
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
     -- The duel runs Monday to Saturday. Sunday's board is still there to be
     -- read, at 0 for everybody, and counting it marked every member absent
     -- one day a week (0213). Donations run every day and keep Sunday.
     where not (bd.board = 'duel'
                and extract(isodow from d.day_start at time zone 'UTC') = 7)
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
      count(*) filter (where d.score > 0)::int as scored,
      -- Days at or above the alliance's own bar for this board (0239). A null
      -- bar makes the comparison null, so nothing counts; the final select
      -- turns "no bar" into a null column rather than a misleading zero.
      count(*) filter (
        where d.score >= case d.board when 'duel' then p_duel_min else p_donation_min end
      )::int as days_over
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
  buildings as materialized (
    -- Levels gained over the range, from the NEWEST reading of each building
    -- type rather than every reading (0238). The old body grouped all of a
    -- member's sightings in the range to take their max and their first: on
    -- prod, for the season range, 4,841 rows a member, ~330,000 rows for 68
    -- members, read from disk -- 28 s against the hosted 8 s statement_timeout,
    -- so the Season tab never loaded. A level only goes up, so the newest
    -- reading in the range IS the top, and the building types come from the
    -- board's own per-player table (0154), one row a player.
    --
    -- Per building TYPE, like the season board, not per object: the board has
    -- never told two buildings of one type apart.
    --
    -- Not identical in one case: if a reading in the range is LOWER than an
    -- earlier one (a misread, 6 -> 5 at the end), the old max kept the 6 and
    -- this keeps the 5. Levels in the data only rise in practice.
    select
      m.player_id,
      sum(greatest(0, cur.level - coalesce(prev.level, first_in.level)))::int as gained
    from members m
    cross join bounds b
    join public.player_season_buildings_current c on c.player_id = m.player_id
    cross join lateral jsonb_object_keys(c.levels) as k(type_id)
    join lateral (
      select s.level
        from public.season_building_snapshots s
       where s.player_id = m.player_id
         and s.building_type_id = k.type_id::int
         and s.level is not null
         and s.captured_at >= b.f
         and s.captured_at < b.t
       order by s.captured_at desc
       limit 1
    ) cur on true
    left join lateral (
      select s.level
        from public.season_building_snapshots s
       where s.player_id = m.player_id
         and s.building_type_id = k.type_id::int
         and s.level is not null
         and s.captured_at < b.f
       order by s.captured_at desc
       limit 1
    ) prev on true
    left join lateral (
      select s.level
        from public.season_building_snapshots s
       where s.player_id = m.player_id
         and s.building_type_id = k.type_id::int
         and s.level is not null
         and s.captured_at >= b.f
         and s.captured_at < b.t
       order by s.captured_at asc
       limit 1
    ) first_in on true
    group by m.player_id
  ),
  -- The Watchtower is the main building, levels 1 to 55; the game calls its
  -- level the main city level and the collector stores it as hq_level
  -- (0214). Read from player_snapshots, which members may read for anybody;
  -- alliance_member_snapshots is own-or-officer (0066). The level is the
  -- newest reading before the range ends; gained is the highest inside the
  -- range less the last before it (or the first inside it), and null when
  -- the range has no reading at all, because a gap is not zero growth.
  -- MATERIALIZED, both this and `buildings`: a CTE used once is inlined, and
  -- the planner then put this one on the inside of a nested loop, running its
  -- per-member range aggregate 4,624 times (68 x 68) for 4 s on prod.
  watchtower as materialized (
    select
      m.player_id,
      latest.level as level,
      case
        when inside.first_level is null then null
        else greatest(0, inside.top - coalesce(prior.level, inside.first_level))
      end as gained
    from members m
    cross join bounds b
    left join lateral (
      select s.hq_level as level
        from public.player_snapshots s
       where s.player_id = m.player_id
         and s.hq_level is not null
         and s.captured_at < b.t
       order by s.captured_at desc
       limit 1
    ) latest on true
    left join lateral (
      select s.hq_level as level
        from public.player_snapshots s
       where s.player_id = m.player_id
         and s.hq_level is not null
         and s.captured_at < b.f
       order by s.captured_at desc
       limit 1
    ) prior on true
    left join lateral (
      select max(s.hq_level) as top,
             (array_agg(s.hq_level order by s.captured_at))[1] as first_level
        from public.player_snapshots s
       where s.player_id = m.player_id
         and s.hq_level is not null
         and s.captured_at >= b.f
         and s.captured_at < b.t
    ) inside on true
  ),
  -- Furnace Fury days with this alliance's member board captured (0212).
  furnace_fought as (
    -- One row per member per day. The board can be read more than once a day
    -- and a score only grows, so the highest reading is the day's score (0241).
    select s.game_uid, s.held_on, max(s.score) as score
      from public.furnace_fury_scores s
      cross join bounds b
     where s.held_on >= b.first_day and s.held_on < b.end_day
       and s.alliance_id = (select public.active_alliance())
     group by s.game_uid, s.held_on
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
        end) as attended,
      -- Present: the typed score, else the scanned one (a tick with no number
      -- typed must not throw away what the board read). Absent: none, whatever
      -- is stored or scanned -- somebody who did not take part has no score.
      -- No typed row: the board's.
      case a.attended
        when true then coalesce(a.score, ff.score)
        when false then null
        else ff.score
      end as score
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
      count(*) filter (where not v.attended)::int as missed,
      -- Null when no day carries a score, so "no scores" is not a total of 0.
      sum(v.score)::bigint as score_total
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
          'missed', coalesce(tm.missed, 0),
          'score', tm.score_total)
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
    wt.level,
    wt.gained,
    coalesce(tf.events, '{}'::jsonb),
    case when p_duel_min is null then null else coalesce(dd.days_over, 0) end,
    case when p_donation_min is null then null else coalesce(dg.days_over, 0) end
  from members m
  cross join bounds b
  left join daily_folded dd on dd.player_id = m.player_id and dd.board = 'duel'
  left join weekly_folded wd on wd.player_id = m.player_id and wd.board = 'duel'
  left join daily_folded dg on dg.player_id = m.player_id and dg.board = 'donation'
  left join weekly_folded wg on wg.player_id = m.player_id and wg.board = 'donation'
  left join black_gold bg on bg.game_uid = m.game_uid
  left join buildings sb on sb.player_id = m.player_id
  left join typed_folded tf on tf.player_id = m.player_id
  left join watchtower wt on wt.player_id = m.player_id
  -- A bad range has no `bounds` row, so the cross join returns nothing
  -- rather than a misleading row of zeroes.
  order by m.current_name;
$$;

comment on function public.record_event_attendance(text, date, jsonb) is
  'Record who took part in one uncaptured event on one game day, for the '
  'alliance being viewed. attended null removes the member''s row. An entry '
  'may carry a score (0241): a number sets it, null clears it, left out keeps it. '
  'data.enter.';
