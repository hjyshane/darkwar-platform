-- 0178: Black Money — who signed up, how each team did, and what each
-- player scored.
--
-- Black Money is the name on screen. On the wire the event is `dragon`,
-- which is why nothing turned up when the capture was searched for the
-- English name. It runs every other Sunday as two teams, A and B, each with
-- 20 starters and up to 20 substitutes, each against its own opponent.
--
-- The fields are OBSERVED, not guessed. Every command below was already in
-- the collector's journal when this was written — the collector has been
-- recording the event since at least 2026-09-14 — and the readings were
-- checked against the screen and the counts it gave on 2026-09-27:
--
--   dragon.assign.player.info -> black_money_signup_snapshots
--     71 members per reading, 20 starters on each team
--   dragon.battle.history     -> black_money_battle_snapshots
--     25 team results back to 2026-04-19
--   chat.get.system.mails     -> black_money_score_snapshots
--     the type-147 battle report: 21 of ours and 22 of theirs for team B
--
-- Every table has a writer in the same change:
--   normalize/black_money_signup.py, black_money_history.py,
--   black_money_report.py.
--
-- Three tables because the grain is three: a member's assignment at one
-- reading, one team's result in one event, one player's score in one battle.
--
-- WHAT IS DELIBERATELY NOT HERE. No event table and no event id. None of the
-- three payloads carries one. A battle is identified by its alliance, its
-- team and when it ended; a signup reading and a battle report are placed
-- against those in SQL, when a reader needs them, rather than stamped here
-- with an id derived from a guess about the calendar.

-- ---------------------------------------------------------------------------
-- Signups
-- ---------------------------------------------------------------------------
--
-- Every member of the alliance is listed, whether or not they signed up.
-- The wire values are kept as sent and interpreted by readers:
--
--   team_index  1 = team A, 2 = team B, null = on neither team
--   state       1 = starter, 2 = substitute, 0 = unassigned. Exactly 20 per
--               team held state 1, which is the starter cap.
--   time_index_record  the time slots the member offered, ';'-separated,
--               against the event's three periods. Unconfirmed against the
--               screen — which is why it stays text.
--   battle_willingness, battle_willingness2  0/1/2, meaning not yet known.
--
-- One reading is one batch, sharing one captured_at, so "latest reading"
-- is the rows sharing the newest instant — the same shape
-- alliance_roster_latest reads.
create table public.black_money_signup_snapshots (
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

  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  name text,
  alliance_abbr text,
  power bigint,
  level int,
  state int,
  team_index int,
  time_index_record text,
  battle_willingness int,
  battle_willingness2 int
);

create index black_money_signup_server_captured_idx
  on public.black_money_signup_snapshots (server_id, captured_at desc);
create index black_money_signup_player_captured_idx
  on public.black_money_signup_snapshots (player_id, captured_at desc)
  where player_id is not null;

-- ---------------------------------------------------------------------------
-- Team results
-- ---------------------------------------------------------------------------
--
-- One row per team per event. A finished battle repeats unchanged in every
-- history response, so the collector keys it by the entry itself and a
-- second screen open lands on the first one's key.
--
-- `score` is the battle's own points and is NOT the sum of the players'
-- scores: 382,529 for team B on 09-27 against 4,978,293 summed over its
-- players' reports. Never compare the two.
--
-- `state` 2 is a win and 3 a loss — true of every one of the 25 captured
-- entries against the two scores. `user_num` is how many of ours entered
-- against `max_user_num` 20; 21 means a substitute went in.
--
-- There is no enemy alliance id. The wire's enemyAllianceId carries OUR id
-- on every entry that has it, so it is left in `raw` and not trusted. The
-- battle report names the opponent by its real id.
--
-- server_id: the history is about the collector's own alliance and carries
-- no server, so the subject's server is the one it was observed from.
create table public.black_money_battle_snapshots (
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

  server_id int not null references public.servers (server_id),
  alliance_id uuid references public.alliances (alliance_id),
  alliance_external_id text not null,
  battle_ended_at timestamptz not null,
  team_index int not null,
  side int,
  state int,
  score bigint,
  user_num int,
  max_user_num int,
  enemy_name text,
  enemy_abbr text,
  enemy_score bigint,
  enemy_user_num int,
  enemy_team_index int
);

create index black_money_battle_server_ended_idx
  on public.black_money_battle_snapshots (server_id, battle_ended_at desc);
create index black_money_battle_alliance_ended_idx
  on public.black_money_battle_snapshots (alliance_external_id, battle_ended_at desc, team_index);

-- ---------------------------------------------------------------------------
-- Player scores
-- ---------------------------------------------------------------------------
--
-- From the battle report mail. Its player list is the team's ACTUAL turnout
-- — only those who entered are in it — so "signed up but did not play" is a
-- signup with no row here, not a row with a zero.
--
-- Both sides are kept: the opponent's players are real players on real
-- servers, and this is the only place their scores appear. Filter on
-- alliance_external_id for ours.
--
-- One report reaches every participant under a different mail uid, and the
-- capture is machine-wide, so two of our accounts opening their mail put the
-- same report in twice (it happened for the 09-13 team A battle). The key is
-- the report's content, so the copies collapse onto one row per player.
--
-- The report carries no battle time. `reported_at` is when the mail was sent,
-- a few minutes after the battle ends (12:54 for a 12:50 end); that is what
-- places a report against its battle.
--
-- score = kill + occupy + first_occupy + collect + escort for every player
-- observed. The parts are kept so a reader never has to trust the total.
create table public.black_money_score_snapshots (
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

  server_id int not null references public.servers (server_id),
  player_id uuid references public.players (player_id),
  game_uid bigint not null,
  name text,
  alliance_id uuid references public.alliances (alliance_id),
  alliance_external_id text not null,
  alliance_abbr text,
  side int,
  win int,
  reported_at timestamptz not null,
  score bigint,
  kill_score bigint,
  occupy_score bigint,
  first_occupy_score bigint,
  collect_score bigint,
  escort_score bigint
);

create index black_money_score_server_reported_idx
  on public.black_money_score_snapshots (server_id, reported_at desc);
create index black_money_score_alliance_reported_idx
  on public.black_money_score_snapshots (alliance_external_id, reported_at desc);
create index black_money_score_player_reported_idx
  on public.black_money_score_snapshots (player_id, reported_at desc)
  where player_id is not null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Member-only, per 0065. The signup list is already visible to every member
-- in the event tab, and the scores are the event's own scoreboard, so
-- neither needs anything tighter than membership. anon is granted nothing.
alter table public.black_money_signup_snapshots enable row level security;
alter table public.black_money_battle_snapshots enable row level security;
alter table public.black_money_score_snapshots enable row level security;

grant select on public.black_money_signup_snapshots to authenticated;
grant select on public.black_money_battle_snapshots to authenticated;
grant select on public.black_money_score_snapshots to authenticated;
-- Explicit, because 0006's blanket grant covered only the tables that
-- existed then.
grant all on public.black_money_signup_snapshots to service_role;
grant all on public.black_money_battle_snapshots to service_role;
grant all on public.black_money_score_snapshots to service_role;

create policy member_read on public.black_money_signup_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.black_money_battle_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.black_money_score_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger black_money_signup_snapshots_notify
  after insert on public.black_money_signup_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger black_money_battle_snapshots_notify
  after insert on public.black_money_battle_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger black_money_score_snapshots_notify
  after insert on public.black_money_score_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

comment on column public.black_money_signup_snapshots.state is
  'Wire value: 1 starter, 2 substitute, 0 unassigned. Read against the '
  'screen on 2026-09-27, where 20 per team held 1 — the starter cap.';

comment on column public.black_money_battle_snapshots.score is
  'The battle''s team points. NOT the sum of black_money_score_snapshots.score '
  'for the team — a different measure, an order of magnitude smaller.';

comment on column public.black_money_battle_snapshots.state is
  'Wire value: 2 win, 3 loss (every captured entry agrees with the two scores).';

comment on column public.black_money_score_snapshots.reported_at is
  'When the battle report mail was sent, minutes after the battle ended. '
  'The report carries no battle time of its own.';
