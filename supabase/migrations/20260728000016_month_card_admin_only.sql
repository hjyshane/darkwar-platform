-- 0016: the monthly pass is admin-only.
--
-- Who pays for a pass is finance, not gameplay. It was flowing to every
-- reader through three doors: the players summary column (public_read),
-- the typed month_card_expires_at on two snapshot tables, and — the one a
-- column-hiding UI change would have missed — the raw jsonb on those same
-- tables, where monthCardEndTime sits in every al.rank / server.rank /
-- kill.rank / get.user.info.multi row. Closing the typed columns while
-- leaving raw readable would be theatre, so raw closes with them.
--
-- HOW: app roles (viewer/member/officer/admin) all share the `authenticated`
-- database role, so column privileges cannot distinguish admin from member.
-- Therefore:
--   * current state moves to its own row-secured table, player_month_cards,
--     where a plain RLS policy can say "admin" (same pattern as
--     battle_report_ingests);
--   * the snapshot columns that would leak it (month_card_expires_at, raw)
--     are revoked from client roles entirely via column-level grants. That
--     includes admins in the UI — admin's current-state view is the new
--     table; snapshot history and raw remain reachable through service-key
--     tooling only (§17.3 already scoped raw to admin, which PostgREST
--     column grants cannot express per app role).
--
-- COST, stated so it is not tripped over later: these two tables now have
-- column-list grants instead of table-level ones. A future migration that
-- adds a column to player_snapshots or alliance_member_snapshots MUST also
-- grant it to anon, authenticated, or PostgREST reads of the new column
-- fail with 42501.
--
-- alliance_contribution_snapshots needs no surgery today: its only parser
-- (get.daily.alliance.donate.rank) has raw of {score, uid, updateTime}.
-- When al.battle.rank.info is promoted — its entries DO carry
-- monthCardEndTime — that parser's migration must extend this treatment.

create table public.player_month_cards (
  player_id uuid primary key references public.players (player_id),
  expires_at timestamptz not null,
  -- When the reading that set expires_at was captured; the newer-wins gate.
  observed_at timestamptz not null
);

alter table public.player_month_cards enable row level security;

-- anon gets the grant so a non-admin dashboard sees a clean empty result
-- (RLS filters every row) rather than a 42501 error; the policy is what
-- actually decides.
grant select on public.player_month_cards to anon, authenticated;
grant all on public.player_month_cards to service_role;

create policy admin_read on public.player_month_cards
  for select to anon, authenticated
  using (public.current_app_role() = 'admin');

-- Preserve what the summary had already accumulated, then close the door.
insert into public.player_month_cards (player_id, expires_at, observed_at)
select player_id, month_card_expires_at, coalesce(last_seen_at, now())
from public.players
where month_card_expires_at is not null;

alter table public.players drop column month_card_expires_at;

-- The summary triggers now route the pass to the secured table. Otherwise
-- identical to 0011: newer wins, and a missing value never erases a known
-- one (the trigger only sees non-null readings; the parser already turned
-- the -1/0 "no pass" sentinels into null).

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

  return null;
end;
$$;

create or replace function public.apply_player_summary()
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
      server_id = coalesce(s.server_id, p.server_id),
      last_seen_at = s.captured_at
  from (
    select distinct on (player_id)
      player_id, name, hq_level, power, kills, server_id, captured_at
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

  return null;
end;
$$;

-- Close the snapshot doors: column-list grants instead of table-level.

revoke select on public.player_snapshots from anon, authenticated;
grant select (snapshot_id, observation_id, source_command, parser_version,
  idempotency_key, captured_at, collector_id, collected_from_server_id,
  created_at, player_id, server_id, game_uid, name, alliance_external_id,
  hq_level, power, kills, rank)
  on public.player_snapshots to anon, authenticated;

revoke select on public.alliance_member_snapshots from anon, authenticated;
grant select (snapshot_id, observation_id, source_command, parser_version,
  idempotency_key, captured_at, collector_id, collected_from_server_id,
  created_at, alliance_id, server_id, player_id, game_uid, name, member_rank,
  hq_level, power, kills, presence_redacted, online_state)
  on public.alliance_member_snapshots to anon, authenticated;
