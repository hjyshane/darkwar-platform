-- Frankie: who was a member ON THE DAY, not who is a member now.
--
-- 0277 built the grid from `alliance_roster_latest`: every CURRENT member
-- against every event. So the page divided each event's turnout by today's
-- headcount, showed people who joined later as absent from events that
-- predate them, and dropped anyone who has since left even though their
-- damage is on the board. An alliance of 39 that is now 84 read as "39 of 84"
-- for the old events.
--
-- Same function, same columns, different rows: an event's cells are the
-- roster as of that event, plus anyone the event has damage for. A member who
-- was not in the alliance yet has no cell on that event at all (not a null
-- cell), so the page can count the roster per event and hold a member only to
-- the events they were in the alliance for.
--
-- The roster as of an event is the newest roster batch (one `captured_at`)
-- at or before the event's reference instant that is at least as large as the
-- event's own board -- a batch that cannot even hold the people on the board
-- was a partial read. When no earlier batch qualifies, the first later one
-- does: history before the first snapshot is unknown, and the oldest roster
-- is the nearest guess. The reference instant is the Frankie start the board
-- followed, else the read; for a typed-only day, the start of that game day.
--
-- WHY A DEFINER FUNCTION. `alliance_member_snapshots` is own-or-officer (0066): a member's
-- history is theirs. Membership is the other question -- who was in the
-- alliance -- and 0067 already argued members may answer it. So the function
-- reads `alliance_membership_history()`, a definer function that gives member+ the
-- player and the capture and nothing else: no power, no kills, no rank, no
-- time series of anything about a person. The base table stays closed.
--
-- Scope: a board row or typed row counts when the player ever appeared in a
-- roster snapshot of the active alliance (the board is the collector's own
-- alliance, and this keeps an outsider out as 0277 did).

create function public.alliance_membership_history()
returns table (captured_at timestamptz, player_id uuid, game_uid bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.captured_at, s.player_id, s.game_uid
    from public.alliance_member_snapshots s
   where s.player_id is not null
     and s.alliance_id = (select public.active_alliance())
     and (public.current_app_role() in ('member', 'officer', 'admin')
          or public.is_service_request());
$$;

comment on function public.alliance_membership_history() is
  'Who was in the active alliance at each roster capture (0308): the player '
  'and the capture, nothing else. Readable by members because membership is '
  'not history (0067); the table underneath stays own-or-officer.';

revoke all on function public.alliance_membership_history() from public, anon;
grant execute on function public.alliance_membership_history() to authenticated, service_role;

create or replace function public.boss_damage_by_event(p_from date default null, p_to date default null)
returns table (
  event_day date,
  player_id uuid,
  game_uid bigint,
  current_name text,
  member_rank int,
  damage bigint,
  rank int,
  source text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with captured as (
    select distinct on (d.day, s.player_id)
           d.day as event_day, s.player_id, s.game_uid, s.damage, s.rank,
           'captured'::text as source, d.ref_at
      from public.boss_damage_scores s
      cross join lateral (
        select coalesce(
                 (select (e.starts_at at time zone 'UTC' - interval '2 hours')::date
                    from public.alliance_event_times e
                   where e.event_key = 'bio_mutant' and e.slot = 1
                     and e.alliance_id = (select public.active_alliance())
                     and e.starts_at <= s.captured_at
                   order by e.starts_at desc
                   limit 1),
                 (s.captured_at at time zone 'UTC' - interval '2 hours')::date) as day,
               coalesce(
                 (select e.starts_at
                    from public.alliance_event_times e
                   where e.event_key = 'bio_mutant' and e.slot = 1
                     and e.alliance_id = (select public.active_alliance())
                     and e.starts_at <= s.captured_at
                   order by e.starts_at desc
                   limit 1),
                 s.captured_at) as ref_at
      ) d
     where s.player_id is not null
       and exists (
         select 1 from public.alliance_membership_history() x
          where x.player_id = s.player_id)
       and (p_from is null or d.day >= p_from)
       and (p_to is null or d.day <= p_to)
     order by d.day, s.player_id, s.captured_at desc
  ),
  typed as (
    select a.held_on as event_day, a.player_id, pl.game_uid, a.damage,
           null::int as rank, 'typed'::text as source,
           ((a.held_on::timestamp + interval '2 hours') at time zone 'UTC') as ref_at
      from public.event_attendance a
      join public.players pl on pl.player_id = a.player_id
     where a.alliance_id = (select public.active_alliance())
       and a.kind = 'frankie' and a.attended and a.damage is not null
       and (p_from is null or a.held_on >= p_from)
       and (p_to is null or a.held_on <= p_to)
  ),
  merged as (
    select c.event_day, c.player_id, c.game_uid, c.damage, c.rank, c.source, c.ref_at
      from captured c
    union all
    select t.event_day, t.player_id, t.game_uid, t.damage, t.rank, t.source, t.ref_at
      from typed t
     where not exists (
       select 1 from captured c
        where c.event_day = t.event_day and c.player_id = t.player_id)
  ),
  days as (
    select g.event_day, min(g.ref_at) as ref_at, count(*) as on_board
      from merged g
     group by g.event_day
  ),
  batches as (
    select s.captured_at, count(*) as n
      from public.alliance_membership_history() s
     group by s.captured_at
  ),
  day_batch as (
    select d.event_day,
           coalesce(
             (select b.captured_at from batches b
               where b.captured_at <= d.ref_at and b.n >= d.on_board
               order by b.captured_at desc limit 1),
             (select b.captured_at from batches b
               where b.captured_at > d.ref_at and b.n >= d.on_board
               order by b.captured_at asc limit 1)) as roster_at
      from days d
  ),
  on_day as (
    -- the roster of the day...
    select db.event_day, s.player_id, s.game_uid
      from day_batch db
      join public.alliance_membership_history() s
        on s.captured_at = db.roster_at
    union
    -- ...and anyone with damage that day who the roster batch missed
    select g.event_day, g.player_id, g.game_uid
      from merged g
  )
  -- rank is today's: the history view carries none, and a past rank is not
  -- what this page shows (it sorts and labels by who the member is now)
  select o.event_day, o.player_id, o.game_uid, p.current_name, l.member_rank::int,
         g.damage, g.rank, g.source
    from on_day o
    join public.players p on p.player_id = o.player_id
    left join public.alliance_roster_latest l
      on l.player_id = o.player_id and l.alliance_id = (select public.active_alliance())
    left join merged g on g.event_day = o.event_day and g.player_id = o.player_id
   order by o.event_day, g.damage desc nulls last, p.current_name;
$$;

comment on function public.boss_damage_by_event(date, date) is
  'Frankie damage per member per event (0277, 0308): the captured board, else '
  'what an officer typed. The members of an event are the roster as of that '
  'event plus anyone with damage on it, not today''s roster.';
