-- 0031: the schema learns which alliance is ours — from the payload, not a
-- setting.
--
-- The handover has carried "the schema has to know 'our alliance'" as an open
-- question behind the duel summary. Running the dashboard on real data turned
-- it into a visible defect somewhere else first: the Members tab lists
-- public.players ordered by power, and players accumulates everyone the
-- collector has ever seen — 557 rows from cross-server boards, kill rankings
-- and other servers' arena entries against 93 actual members. Our members
-- ranked 91st to 557th by power, so the top 50 the tab showed contained none
-- of them and every contribution column was blank by construction.
--
-- The tempting fix is a config value naming the alliance. That would be a
-- fact stated by hand and then trusted forever, and the repo already has a
-- better source: al.rank ALREADY distinguishes them.
--
-- The game hides other alliances' presence — a roster you are not in comes
-- back with everyone online, offLineTime 0 and pointId 0. The parser calls
-- that presence_redacted (FR-CORE-003, verified against v0.4.1). A roster
-- that reports real presence is therefore one the collector account is a
-- member of. That is an observation, which is what this project stores.
--
-- Kept on alliances rather than derived in the query because
-- alliance_member_snapshots is member-only (0006) — a logged-out reader
-- cannot see it, and the Members tab has to list names and power for
-- everyone. alliances is world-readable and is where the public half of an
-- alliance fact belongs.

alter table public.alliances
  add column is_own boolean not null default false;

comment on column public.alliances.is_own is
  'True when we have seen a roster for this alliance WITH real presence. The '
  'game redacts presence for alliances the viewer is not in, so an '
  'unredacted al.rank response is evidence of membership rather than a '
  'configured claim. Set by apply_roster_summary; never written by hand.';

create index alliances_is_own_idx on public.alliances (is_own) where is_own;

-- Backfill from the snapshots already stored.
update public.alliances a
set is_own = true
where exists (
  select 1 from public.alliance_member_snapshots s
  where s.alliance_id = a.alliance_id and not s.presence_redacted
);

-- Same body as 0030 — carried forward whole, per 0024's warning that
-- rebuilding this function from an older definition silently reverts the
-- month-card and presence blocks. The only addition is the ownership mark.
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

  -- Seeing real presence for an alliance means the collector is in it. Only
  -- ever set true: opening someone else's roster afterwards must not unmark
  -- ours, and leaving an alliance is not something a roster response says.
  update public.alliances a
  set is_own = true
  where not a.is_own
    and exists (
      select 1 from new_rows n
      where n.alliance_id = a.alliance_id and not n.presence_redacted
    );

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
