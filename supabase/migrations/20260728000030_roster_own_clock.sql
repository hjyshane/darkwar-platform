-- 0030: the roster summary stops gating on a clock other triggers move.
--
-- Found by running the dashboard against real data for the first time. Of 93
-- alliance members, exactly ONE had current_alliance_id set. The roster
-- snapshots were all correct — 113 rows, no null alliance_id, no null
-- player_id — and the projection onto players had simply been refused.
--
-- apply_roster_summary gates every column it writes on one shared clock:
--
--   and (p.last_seen_at is null or p.last_seen_at < s.captured_at)
--
-- but players.last_seen_at is not this trigger's to own. 0020 says so out
-- loud — "last_seen_at still belongs to players: it records that we observed
-- the player at all" — and apply_contribution_summary advances it from
-- contribution snapshots. So a donation reading captured after the roster
-- moves the gate past the roster's own captured_at, and the next roster
-- projection is dropped whole: name, hq_level, power, kills, server_id and
-- current_alliance_id together.
--
-- Measured on the real fixtures: roster captured 2026-07-27T21:29Z, and all
-- 93 members already carried a last_seen_at at or beyond it. 93 of 93 refused.
--
-- Worse than a lost update, it is order-dependent. Replay al.rank first and
-- the alliance lands; replay the donation boards first and it never does,
-- because nothing revisits it until a strictly newer roster capture arrives.
--
-- This is the trap 0015 named and 0028 finished removing INSIDE contribution
-- ("each gates on its OWN timestamp, so a fresh daily reading is not held
-- back by a newer weekly one"). It was never removed BETWEEN sources. The fix
-- is the same shape: give the roster projection its own timestamp.

alter table public.players add column roster_observed_at timestamptz;

comment on column public.players.roster_observed_at is
  'captured_at of the newest roster snapshot projected onto this row. The '
  'gate for apply_roster_summary, kept separate from last_seen_at because '
  'that column is advanced by other triggers and cannot order this one.';

-- Backfill from what the snapshots already say, so existing rows are not
-- stuck behind a null gate deciding they are current when they are not.
update public.players p
set roster_observed_at = s.captured_at
from (
  select player_id, max(captured_at) as captured_at
  from public.alliance_member_snapshots
  where player_id is not null
  group by player_id
) s
where p.player_id = s.player_id;

-- Re-project every roster snapshot that the shared gate refused. Without
-- this the fix only helps future captures, and the alliance ids already
-- observed stay missing until someone happens to capture al.rank again.
update public.players p
set current_name = coalesce(s.name, p.current_name),
    hq_level = coalesce(s.hq_level, p.hq_level),
    power = coalesce(s.power, p.power),
    kills = coalesce(s.kills, p.kills),
    current_alliance_id = coalesce(s.alliance_id, p.current_alliance_id),
    server_id = coalesce(s.server_id, p.server_id)
from (
  select distinct on (player_id)
    player_id, name, hq_level, power, kills, alliance_id, server_id
  from public.alliance_member_snapshots
  where player_id is not null
  order by player_id, captured_at desc
) s
where p.player_id = s.player_id;

-- Carried forward from 0024, NOT from 0008 or 0016. 0024's own comment warns
-- that this function has been rebuilt from a stale definition before and
-- silently reverted the month-card and presence blocks; both are reproduced
-- here unchanged, and 08/12/17's tests are what catch it if they are not.
-- The only change is which clock the first statement gates on.
create or replace function public.apply_roster_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.players p
  set current_name = coalesce(s.name, p.current_name),
      hq_level = coalesce(s.hq_level, p.hq_level),
      power = coalesce(s.power, p.power),
      kills = coalesce(s.kills, p.kills),
      current_alliance_id = coalesce(s.alliance_id, p.current_alliance_id),
      server_id = coalesce(s.server_id, p.server_id),
      roster_observed_at = s.captured_at,
      -- greatest(), not assignment: this is no longer the gate, so a roster
      -- older than some other source's sighting must not drag it backwards.
      last_seen_at = greatest(coalesce(p.last_seen_at, s.captured_at), s.captured_at)
  from (
    select distinct on (player_id)
      player_id, name, hq_level, power, kills, alliance_id, server_id, captured_at
    from new_rows
    where player_id is not null
    order by player_id, captured_at desc
  ) s
  where p.player_id = s.player_id
    and (p.roster_observed_at is null or p.roster_observed_at < s.captured_at);

  insert into public.player_month_cards (player_id, expires_at, observed_at)
  select distinct on (player_id) player_id, month_card_expires_at, captured_at
  from new_rows
  where player_id is not null and month_card_expires_at is not null
  order by player_id, captured_at desc
  on conflict (player_id) do update
    set expires_at = excluded.expires_at, observed_at = excluded.observed_at
    where public.player_month_cards.observed_at < excluded.observed_at;

  insert into public.player_names (player_id, name, first_seen_at, last_seen_at)
  select player_id, name, min(captured_at), max(captured_at)
  from new_rows
  where player_id is not null and name is not null
  group by player_id, name
  on conflict (player_id, name) do update
  set first_seen_at = least(public.player_names.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.player_names.last_seen_at, excluded.last_seen_at);

  -- Presence, newer-wins on the snapshot's captured_at. A redacted snapshot
  -- is skipped entirely rather than written as null: the server withheld the
  -- answer, and overwriting a known state with "unknown" would lose presence
  -- every time someone opens another alliance's roster.
  insert into public.player_presence as pp (
    player_id, online_state, offline_since, observed_at
  )
  select player_id, online_state, offline_since, captured_at
  from (
    select distinct on (player_id)
      player_id, online_state, offline_since, captured_at
    from new_rows
    where player_id is not null and not presence_redacted and online_state is not null
    order by player_id, captured_at desc
  ) s
  on conflict (player_id) do update
  set online_state = excluded.online_state,
      offline_since = excluded.offline_since,
      observed_at = excluded.observed_at
  where pp.observed_at < excluded.observed_at;

  return null;
end;
$$;

-- The roster tab filters on this, and it is read for every member listing.
create index players_alliance_power_idx
  on public.players (current_alliance_id, power desc nulls last)
  where current_alliance_id is not null;
