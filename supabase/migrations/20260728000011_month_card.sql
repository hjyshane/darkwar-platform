-- 0011: promote the monthly pass expiry from raw to a typed column.
--
-- monthCardEndTime appears in six confirmed responses (al.rank, server.rank,
-- kill.rank, get.user.info.multi, al.battle.rank.info, rank.get.by.range),
-- which is the "observed consistently" bar the schema conventions ask for
-- before promoting a key out of raw.
--
-- Two traps the real payloads contain, handled in the parser rather than here:
-- the value is in SECONDS while headSkinET in the same object is in
-- milliseconds, and -1 (as well as 0) is the sentinel for "no pass" — 31 of 93
-- roster members carried -1, which naive conversion would have rendered as
-- December 1969.

alter table public.alliance_member_snapshots add column month_card_expires_at timestamptz;
alter table public.player_snapshots add column month_card_expires_at timestamptz;
-- Current state for the dashboard; history stays in the snapshot tables so
-- activation, renewal and expiry remain reconstructible.
alter table public.players add column month_card_expires_at timestamptz;

-- Carry it into the summary. Same newer-wins rule as 0008: an older snapshot
-- must not overwrite a newer reading, and a null must not erase a known one.
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
      month_card_expires_at = coalesce(s.month_card_expires_at, p.month_card_expires_at),
      last_seen_at = s.captured_at
  from (
    select distinct on (player_id)
      player_id, name, hq_level, power, kills, alliance_id, server_id,
      month_card_expires_at, captured_at
    from new_rows
    where player_id is not null
    order by player_id, captured_at desc
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);

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
      month_card_expires_at = coalesce(s.month_card_expires_at, p.month_card_expires_at),
      last_seen_at = s.captured_at
  from (
    select distinct on (player_id)
      player_id, name, hq_level, power, kills, server_id,
      month_card_expires_at, captured_at
    from new_rows
    where player_id is not null
    order by player_id, captured_at desc
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);

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
