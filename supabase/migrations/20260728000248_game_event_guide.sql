-- 0248: what scores in Survival Preparedness and the Alliance Duel.
--
-- Both are weeks of themed events. The server sends the shape and the client's own
-- `score` datatable says what each id is and is worth, so the guide is the game's,
-- not typed (dw-collector game-event-guide). Nothing here is about a member: the points
-- a person earns vary with their buffs, so these are the actions that score and their
-- base value. Read by every member, written only by the collector's service key.
--
--   game_event_themes    one row per theme: Survival Preparedness has five, the Duel one
--                        a weekday (`day`, Monday = 1) with a daily and a weekly score to reach
--   game_event_scores    what scores in a theme: `action`, and `points` paid per `per_value`
--   game_event_calendar  Survival Preparedness: which theme runs in which of the day's six
--                        4-hour slots (slot 1 starts at 00:00 server time, UTC-2)

create table public.game_event_themes (
  activity_id text not null,
  event_id text not null,
  day int check (day between 1 and 7),
  name text,
  name_ko text,
  min_day_score int,
  min_week_score int,
  updated_at timestamptz not null default now(),
  primary key (activity_id, event_id)
);

create table public.game_event_scores (
  activity_id text not null,
  event_id text not null,
  score_id text not null,
  action text,
  action_ko text,
  -- `points` is paid for each `per_value` (1 = per action, 100 = per hundred).
  per_value int not null check (per_value > 0),
  points int not null check (points >= 0),
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (activity_id, event_id, score_id),
  foreign key (activity_id, event_id)
    references public.game_event_themes (activity_id, event_id) on delete cascade
);

create table public.game_event_calendar (
  activity_id text not null,
  day int not null check (day between 1 and 7),
  slot int not null check (slot between 1 and 12),
  event_id text not null,
  updated_at timestamptz not null default now(),
  primary key (activity_id, day, slot)
);

alter table public.game_event_themes enable row level security;
alter table public.game_event_scores enable row level security;
alter table public.game_event_calendar enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything (0207).
revoke all on public.game_event_themes, public.game_event_scores, public.game_event_calendar
  from anon, authenticated;
grant select on public.game_event_themes, public.game_event_scores, public.game_event_calendar
  to authenticated;
grant all on public.game_event_themes, public.game_event_scores, public.game_event_calendar
  to service_role;

create policy member_read on public.game_event_themes
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy member_read on public.game_event_scores
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy member_read on public.game_event_calendar
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.game_event_themes is
  'Themes of Survival Preparedness (100004) and the Alliance Duel (70005), from the '
  'game (0248). Written by dw-collector game-event-guide.';
comment on table public.game_event_scores is
  'What scores in each theme and its base value, from the client''s score table (0248). '
  'Not what anybody earned: buffs make that differ.';
comment on table public.game_event_calendar is
  'Survival Preparedness: the theme in each 4-hour slot of each weekday (0248).';
