-- 0024: al.rank has been telling us when each member actually went offline,
-- and nothing read it.
--
-- `offLineTime` sits in every al.rank member row as a millisecond epoch, and
-- the parser has only ever used it as one input to the presence-redaction
-- heuristic before dropping it into `raw`. Measured over a real 93-member
-- roster: online = true holds exactly when offLineTime = 0, with no
-- exceptions, and the other 84 carry a genuine last-offline timestamp.
--
-- This is not the same fact as players.last_seen_at. 0008 sets that from a
-- snapshot's captured_at, so it means "when the collector last observed this
-- player" — a data-freshness signal, which is what the dashboard's Last Seen
-- column and its freshness badge are actually for. It says nothing about when
-- the player was last playing.
--
-- Why a separate member-only table rather than columns on players: 0020 moved
-- four columns off players for exactly this reason and wrote down the rule —
-- players carries `public_read ... using (true)` and the publishable key is in
-- the browser bundle, so anything alliance-internal is world-readable there.
-- Presence is alliance-internal (§17.3, and 0006 restricted
-- alliance_member_snapshots on those grounds). 0020's own comment names
-- online_state as "the real presence signal"; this table is its current-state
-- projection and has to sit behind the same boundary.

alter table public.alliance_member_snapshots
  add column offline_since timestamptz;

comment on column public.alliance_member_snapshots.offline_since is
  'When the member was last seen going offline (al.rank offLineTime, ms epoch). '
  'Null when they were online at capture, and null for a presence_redacted '
  'snapshot, where the server reports everyone online with offLineTime 0.';

create table public.player_presence (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  online_state text,
  offline_since timestamptz,
  observed_at timestamptz not null
);

comment on table public.player_presence is
  'Current presence per player, member+ only. Split from public.players for '
  'the same reason as player_contributions: that table is world-readable and '
  'presence is alliance-internal.';

comment on column public.player_presence.observed_at is
  'captured_at of the snapshot this state came from. Gates newer-wins, and '
  'tells a reader how stale the presence is — "offline since X, as of Y".';

alter table public.player_presence enable row level security;

-- anon is granted so a logged-out dashboard gets a clean empty result (RLS
-- filters every row) instead of 42501; the policy is what actually decides.
grant select on public.player_presence to anon, authenticated;

create policy member_read on public.player_presence
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- Extends the roster summary rather than adding a second trigger on the same
-- table: one statement-level pass over new_rows stays one pass.
--
-- Carried forward from 0016, NOT from 0008. This function has been replaced
-- twice already (0011 added the month pass, 0016 routed it to the secured
-- table), and rebuilding it from the original definition silently reverted
-- both — caught here by 08_month_card_test and 12_month_card_admin_test.
-- Only the presence block at the end is new.
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
      last_seen_at = s.captured_at
  from (
    select distinct on (player_id)
      player_id, name, hq_level, power, kills, alliance_id, server_id, captured_at
    from new_rows
    where player_id is not null
    order by player_id, captured_at desc
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);

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
