-- 0136: the two season 3 ranking boards.
--
-- Both come from `season_tab_map_building.pcapng` (2026-08-20), read
-- shape-only. The field reading is written up in
-- docs/runbooks/season-map-capture.md.
--
--   get.alliance.season.score.rank -> 89 alliances, every listed field
--     present in 89/89 rows across both observations
--   desert.force.server.rank       -> 149 players, every listed field
--     present in 149/149 rows
--
-- Both tables have a writer, in the same change:
--   normalize/season_score_rank.py   -> alliance_season_score_snapshots
--   normalize/desert_force_rank.py   -> player_season_force_snapshots
-- Stated because this repo has one case of the opposite —
-- `al.battle.rank.info` was marked "promote", never was, and
-- `contribution_type='alliance_battle'` has been an empty dashboard column
-- ever since. A snapshot table with no parser is that bug waiting to happen.
--
-- Two tables rather than one, for the same reason 0018 split the component
-- boards off `player_snapshots`: the grain differs. One board scores
-- ALLIANCES on a season score, the other ranks PLAYERS on a "force" value.
-- Folding them together would leave half the columns null on every row.

-- ---------------------------------------------------------------------------
-- Alliance season score board
-- ---------------------------------------------------------------------------
--
-- server_id is the subject's server, per the schema conventions, and here
-- that matters more than usual: this board REACHES OUTSIDE THE TRACKED
-- GROUP. The observed response carried serverIds 580, 584, 586 and 588 —
-- and `servers` is seeded 577-584, so 586 and 588 are not in it. That is
-- already handled: sync's ensure_servers() registers an unseen server as
-- server_group='unknown', is_tracked=false so the FK resolves without
-- anything treating it as ours (NFR-007). The FK is kept deliberately; it
-- is what forces that registration to happen.
--
-- A season group is FOUR servers (get.season.group.server.info returned a
-- serverList of 4) and they are not a contiguous slice of the home group.
-- Nothing here should assume season membership matches `server_group`.
create table public.alliance_season_score_snapshots (
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
  -- Nullable for the same reason player_id is nullable on
  -- player_component_power_snapshots: the collector cannot produce it, the
  -- sync worker resolves it, and the durable key is the game's own id.
  --
  -- In practice it resolves. Measured on a real 89-row board, every row got
  -- an alliance_id — sync's ensure_alliance() mints the identity row even for
  -- the untracked season servers, leaving 25 alliances on 586 and 21 on 588
  -- in `alliances`. That is the same thing al.battle.rank.info already does
  -- with 586, so it is existing behaviour rather than something this board
  -- introduces; noted because it means `alliances` holds rows for servers
  -- nobody sweeps. external_id is the column to join on regardless.
  alliance_id uuid references public.alliances (alliance_id),
  -- 32-hex, matching public.alliances.external_id (verified: 89/89 rows).
  alliance_external_id text not null,
  alliance_name text,
  alliance_abbr text,
  country text,
  leader_name text,
  score bigint,
  power bigint,
  rank int,
  -- The server sends the previous rank itself. Worth a typed column rather
  -- than deriving movement from the preceding snapshot the way
  -- rank_period_movement does — this is observed, not calculated, and the
  -- two must not be confused (spec 14.4).
  previous_rank int
);

-- server_id leads, per the schema conventions: the group grows to 12/16/32/64.
create index alliance_season_score_server_captured_idx
  on public.alliance_season_score_snapshots (server_id, captured_at desc);
create index alliance_season_score_alliance_captured_idx
  on public.alliance_season_score_snapshots (alliance_id, captured_at desc)
  where alliance_id is not null;
-- The board is read a whole board at a time, and external_id is the join
-- that works for alliances on untracked servers where alliance_id is null.
create index alliance_season_score_external_captured_idx
  on public.alliance_season_score_snapshots (alliance_external_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Player season force board
-- ---------------------------------------------------------------------------
--
-- The response carries NO serverId per entry (0 of 149 rows had one), so
-- server_id is decoded from the uid's trailing six digits — the same D-1
-- rule rank_by_range.py already uses. Every uid in the observed response
-- was 16 digits and decoded to 580, i.e. this board is server-local even
-- though the alliance board above is not. Do not assume they share a scope.
--
-- `force` is the season's INFLUENCE figure, and is NOT power: the board
-- carries no power column and nothing observed ties the two. It must not be
-- written into any power column.
--
-- The column keeps the wire name `force` rather than being called influence,
-- so a row stays traceable to the payload field that produced it. The
-- translation to what a reader sees lives in the dashboard's terms file.
create table public.player_season_force_snapshots (
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
  alliance_external_id text,
  alliance_name text,
  alliance_abbr text,
  country text,
  force bigint,
  rank int
);

create index player_season_force_server_captured_idx
  on public.player_season_force_snapshots (server_id, captured_at desc);
create index player_season_force_player_captured_idx
  on public.player_season_force_snapshots (player_id, captured_at desc)
  where player_id is not null;

-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- No season instance / group column. Neither board response carries a
-- groupId — only get.season.group.server.info does, and correlating the two
-- by time would be a guess dressed as a key. Boards are separated by
-- captured_at until a season instance is actually modelled from its own
-- observation; adding the column then is one migration.
--
-- No self_rank / self_score / self_force. Both responses carry the
-- collector's own standing at the TOP LEVEL, not per row, so it does not
-- belong in a per-row board table, and repeating it on every row to keep it
-- would denormalise a fact about one player across the whole board. It is
-- recoverable: the collector appears in the board rows, and
-- desert.force.self.rank returns its own rank directly.
--
-- No cosmetic fields. icon, pic, picVer, headSkinId, headSkinET,
-- monthCardEndTime and banType land in `raw` and get promoted only if
-- something actually needs them.

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Member-only, per 0065: nothing in this app is public, and a signed-in
-- viewer is not enough — holding the role is the gate. anon is granted
-- nothing, so it gets 42501 rather than an empty list.
-- 34_no_public_read_test is what would catch this being forgotten.
alter table public.alliance_season_score_snapshots enable row level security;
alter table public.player_season_force_snapshots enable row level security;

grant select on public.alliance_season_score_snapshots to authenticated;
grant select on public.player_season_force_snapshots to authenticated;
grant all on public.alliance_season_score_snapshots to service_role;
grant all on public.player_season_force_snapshots to service_role;

create policy member_read on public.alliance_season_score_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy member_read on public.player_season_force_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create trigger alliance_season_score_snapshots_notify
  after insert on public.alliance_season_score_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger player_season_force_snapshots_notify
  after insert on public.player_season_force_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

comment on column public.player_season_force_snapshots.force is
  'INFLUENCE. The wire field is `force` on desert.force.server.rank and the '
  'column keeps that name for traceability; influence is what it measures. '
  'Not power — nothing observed relates the two. Never write it to a power column.';

comment on column public.alliance_season_score_snapshots.score is
  'COAL PRODUCTION. The wire field is `score` on get.alliance.season.score.rank '
  'and the column keeps that name for traceability; coal production is what it '
  'measures. Not power, and not comparable with the influence board beside it.';

comment on column public.alliance_season_score_snapshots.previous_rank is
  'The board''s own oldRank. Observed, sent by the server — not derived from '
  'a preceding snapshot the way rank_period_movement computes movement.';
