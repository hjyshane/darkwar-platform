-- 0062: the arena has two leagues, and half of it was invisible.
--
-- `user.get.arena.info` returns a different board depending on which league
-- you ask for. Both were being stored correctly — idempotency_key hashes the
-- raw payload (§11.2), so the two responses never collided — but nothing
-- distinguished them, and the dashboard took `order by captured_at desc
-- limit 1`. Whichever league happened to be captured last was the only one
-- anybody saw. In the live database that was Silver, and Gold's 163 players
-- had been sitting there unread.
--
-- The discriminator is `userArenaType`. Two independent signals agree on it
-- in every snapshot captured so far:
--
--   userArenaType = 1  fightServers '580;582'  163 players  scores 1092-1678
--   userArenaType = 2  fightServers '580'      122 players  scores 1214-1474
--
-- Silver is the single-server board (confirmed by the user against the game).
-- So 1 = Gold, cross-server; 2 = Silver, own server only. The payload never
-- says "gold" or "silver" anywhere — it is a number, and the mapping is
-- recorded here rather than inferred again later.
--
-- `arenaType` and `selfArenaType` are both 1 in every snapshot, including the
-- Silver ones, so neither is the board's league. They stay in `raw`.
-- `selfArenaType` is most likely the collector account's OWN league, which
-- would explain why it does not move when the viewed board does; that is a
-- guess and is not promoted on a guess.
--
-- Nullable on purpose. Snapshots captured before this key was understood, and
-- the seed's synthetic one, genuinely do not know their league, and
-- FR-UI-008 says unknown is unknown. No check constraint: the game may well
-- have a third league, and a constraint written from two observations would
-- reject the first capture that proves it.

alter table public.arena_snapshots add column league smallint;

comment on column public.arena_snapshots.league is
  'Which arena board this is, from the payload''s userArenaType. 1 = Gold '
  '(cross-server), 2 = Silver (own server only). Null when the capture '
  'predates the field being understood. Not constrained — a third league '
  'would be new information, not a violation.';

update public.arena_snapshots
set league = (raw ->> 'userArenaType')::smallint
where raw ? 'userArenaType'
  and (raw ->> 'userArenaType') ~ '^[0-9]+$';

-- The dashboard's question is "the newest board for each league", and
-- server_id leads because the group grows past 580/582.
create index arena_snapshots_league_idx
  on public.arena_snapshots (server_id, league, captured_at desc);
