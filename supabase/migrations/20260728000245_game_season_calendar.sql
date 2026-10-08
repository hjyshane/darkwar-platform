-- 0245: a new season is detected, not typed.
--
-- The login response carries the game's own season calendar (`seasonStage`,
-- `nextSeasonStage`, `seasonInfo`; normalize/game_season.py). Observed on the
-- live journal on 2026-10-08: stage 1 began 2026-05-25 02:00 UTC, stage 2 on
-- 2026-08-17 02:00 (the date this project has always called Season 3), it
-- settles 2026-10-05 02:00, and `nextSeasonStage` has named stage 3 for
-- 2026-11-09 02:00 since 2026-09-28. The game's stage is one below the
-- alliance's season number (stage 2 is "Season 3"), so season_id = stage + 1.
--
--   * game_season_snapshots: one row per distinct calendar a login showed (a
--     handful per year), written by the collector like every other snapshot.
--   * internal.apply_game_season(): after each new snapshot, makes sure the
--     seasons the game names exist and have their dates. It only FILLS what is
--     missing - a new season, an empty start, an empty end - and never
--     overwrites a name or a date somebody set in Settings, so a hand edit
--     always wins and a repeat of the same calendar changes nothing.
--     A failure inside it is a warning, not an error: it must never cost the
--     snapshot (RAISE EXCEPTION would roll the insert back, CLAUDE.md).
--
-- A season created here has a name ("Season 4") and a start, and no buildings:
-- their names are not on the wire, so they still arrive through the sweeps and
-- season_unnamed_buildings() (0242). The current season is still "the latest
-- whose start has passed", so Season 4 changes nothing until 2026-11-09, and
-- the duel-round anchor (0242) moves with it that day: four-week rounds from
-- 2026-08-17 reach 2026-11-09 exactly (84 days, three rounds), so no round
-- is cut in two.

create table public.game_season_snapshots (
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

  -- The game's own stage number, as sent.
  stage int not null check (stage >= 0),
  starts_at timestamptz not null,
  next_stage int check (next_stage is null or next_stage > stage),
  next_starts_at timestamptz,
  settle_at timestamptz,
  end_reward_at timestamptz,
  check ((next_stage is null) = (next_starts_at is null))
);

create index game_season_snapshots_stage_idx
  on public.game_season_snapshots (stage, captured_at desc);

alter table public.game_season_snapshots enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207).
revoke all on public.game_season_snapshots from anon, authenticated;
grant select on public.game_season_snapshots to authenticated;
grant all on public.game_season_snapshots to service_role;

create policy member_read on public.game_season_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.game_season_snapshots is
  'The game''s season calendar from each distinct login (0245). Written by the '
  'collector; internal.apply_game_season() turns it into seasons rows.';

-- Creates or fills one season. Never overwrites: name, start and end are each
-- set only while empty, and an end that would not come after the start is
-- left empty rather than violating the table's check.
create function internal.fill_season(
  p_season_id int,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  insert into public.seasons (season_id, name, starts_at, ends_at)
  values (
    p_season_id,
    'Season ' || p_season_id,
    p_starts_at,
    case when p_ends_at > p_starts_at then p_ends_at end)
  on conflict (season_id) do nothing;

  select s.starts_at into v_start from public.seasons s where s.season_id = p_season_id;

  update public.seasons s
     set starts_at = coalesce(s.starts_at, p_starts_at),
         ends_at = coalesce(
           s.ends_at,
           case when p_ends_at > coalesce(s.starts_at, p_starts_at) then p_ends_at end),
         updated_at = now()
   where s.season_id = p_season_id
     and ((s.starts_at is null and p_starts_at is not null)
          or (s.ends_at is null
              and p_ends_at is not null
              and p_ends_at > coalesce(v_start, p_starts_at)));
end;
$$;

revoke all on function internal.fill_season(int, timestamptz, timestamptz) from public, anon, authenticated;

create function internal.apply_game_season()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.fill_season(new.stage + 1, new.starts_at, new.settle_at);
  if new.next_stage is not null then
    perform internal.fill_season(new.next_stage + 1, new.next_starts_at, null);
  end if;
  return new;
exception when others then
  raise warning 'apply_game_season: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

revoke all on function internal.apply_game_season() from public, anon, authenticated;

create trigger game_season_snapshots_apply
  after insert on public.game_season_snapshots
  for each row execute function internal.apply_game_season();

-- What the journal already showed, so the dashboard knows today and not only
-- after the next login: Season 2 began with game stage 1 and settled
-- 2026-07-13, Season 3 settles 2026-10-05, Season 4 (stage 3) is announced for 2026-11-09. Fill-only, like
-- the trigger: anything already in the table stays.
select internal.fill_season(2, timestamptz '2026-05-25 02:00:00+00', timestamptz '2026-07-13 02:00:00+00');
select internal.fill_season(3, timestamptz '2026-08-17 02:00:00+00', timestamptz '2026-10-05 02:00:00+00');
select internal.fill_season(4, timestamptz '2026-11-09 02:00:00+00', null);
