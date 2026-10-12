-- 0277: Frankie (Bio-Mutant) damage per member per event, captured.
--
-- Asked for on 2026-10-11: a Frankie page with each member's dates and damage,
-- and a trend. Until now the only record was what an officer typed
-- (event_attendance, kind 'frankie').
--
-- The source is `alliance.boss.damage.rank.new`: the alliance's boss damage
-- board for the event, one row per participant with their damage. Checked
-- against the game on 2026-10-11:
--   * It is PER EVENT, not cumulative. The 10-05 board summed to
--     830,655,667,504 and `dmgRecordArr` (the alliance's best event) became
--     exactly that number the same day; the 10-11 board (563,859,036,205) is
--     below the record, which stayed.
--   * One event is two rounds (02:30 and 15:00 UTC) on one game day, about
--     every third day. The board carries no time and no event id, so the event
--     day is the Frankie start (alliance_event_times, bio_mutant slot 1) the
--     read followed -- see boss_damage_by_event.
--   * It is the complete participant list (39 and 45 members on the two days
--     read), unlike `alliance.boss.personal.damage`, which is only the rallies
--     the collector's account saw and is NOT used.
--
-- The board is only captured when somebody opens it. A later read of the same
-- event replaces the earlier one in the report (damage only grows inside an
-- event); every read is kept as a row.

create table public.boss_damage_scores (
  snapshot_id uuid primary key,
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
  -- The game day the board was read on. NOT the event day: the report maps a
  -- read to the Frankie start it followed.
  held_on date not null,
  -- The member's place on the board and what they did to the boss.
  rank int check (rank is null or rank > 0),
  damage bigint not null check (damage >= 0)
);

create index boss_damage_scores_player_idx
  on public.boss_damage_scores (player_id, captured_at desc);

comment on table public.boss_damage_scores is
  'Frankie damage board (alliance.boss.damage.rank.new, 0277): one row per '
  'member per distinct read. Per event, not cumulative. On it = took part.';

alter table public.boss_damage_scores enable row level security;
-- revoke-then-grant: hosted default privileges give authenticated all (0207).
revoke all on public.boss_damage_scores from anon, authenticated;
grant select on public.boss_damage_scores to authenticated;
grant all on public.boss_damage_scores to service_role;

create policy member_read on public.boss_damage_scores
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- ---------------------------------------------------------------------------
-- The page's read: a grid of every current member against every event that has
-- any damage on record, damage null where the member has none (did not take
-- part, or was not on the board).
--
-- The event day is the game day of the latest Frankie start at or before the
-- read, and the day of the read itself when no start is known. A typed row
-- (event_attendance, kind frankie, ticked present, with a damage) fills in
-- events nobody captured, and a captured row wins for the same member and day.
-- Membership is the roster view (CLAUDE.md: never current_alliance_id).

create function public.boss_damage_by_event(p_from date default null, p_to date default null)
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
  with members as (
    select r.player_id, r.game_uid, r.member_rank
      from public.alliance_roster_latest r
     where r.alliance_id = (select public.active_alliance())
  ),
  captured as (
    select distinct on (d.day, s.player_id)
           d.day as event_day, s.player_id, m.game_uid, s.damage, s.rank,
           'captured'::text as source
      from public.boss_damage_scores s
      join members m on m.player_id = s.player_id
      cross join lateral (
        select coalesce(
          (select (e.starts_at at time zone 'UTC' - interval '2 hours')::date
             from public.alliance_event_times e
            where e.event_key = 'bio_mutant' and e.slot = 1
              and e.alliance_id = (select public.active_alliance())
              and e.starts_at <= s.captured_at
            order by e.starts_at desc
            limit 1),
          (s.captured_at at time zone 'UTC' - interval '2 hours')::date) as day
      ) d
     where (p_from is null or d.day >= p_from)
       and (p_to is null or d.day <= p_to)
     order by d.day, s.player_id, s.captured_at desc
  ),
  typed as (
    select a.held_on as event_day, a.player_id, m.game_uid, a.damage,
           null::int as rank, 'typed'::text as source
      from public.event_attendance a
      join members m on m.player_id = a.player_id
     where a.kind = 'frankie' and a.attended and a.damage is not null
       and (p_from is null or a.held_on >= p_from)
       and (p_to is null or a.held_on <= p_to)
  ),
  merged as (
    select c.event_day, c.player_id, c.damage, c.rank, c.source from captured c
    union all
    select t.event_day, t.player_id, t.damage, t.rank, t.source from typed t
     where not exists (
       select 1 from captured c
        where c.event_day = t.event_day and c.player_id = t.player_id)
  ),
  days as (
    select distinct g.event_day from merged g
  )
  select d.event_day, m.player_id, m.game_uid, p.current_name, m.member_rank::int,
         g.damage, g.rank, g.source
    from days d
    cross join members m
    join public.players p on p.player_id = m.player_id
    left join merged g on g.event_day = d.event_day and g.player_id = m.player_id
   order by d.event_day, g.damage desc nulls last, p.current_name;
$$;

comment on function public.boss_damage_by_event(date, date) is
  'Frankie damage per current member per event (0277): the captured board, '
  'else what an officer typed. Scoped to the alliance being viewed.';

revoke all on function public.boss_damage_by_event(date, date) from public, anon;
grant execute on function public.boss_damage_by_event(date, date) to authenticated;
