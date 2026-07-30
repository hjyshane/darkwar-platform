-- 0008: keep the identity tables' current summary in step with snapshots.
--
-- players and alliances are defined as "stable identity AND current summary"
-- (§11.3), but nothing maintained the summary: sync creates an entity with
-- its natural key and name, then writes the numbers to snapshot tables only.
-- The dashboard therefore ranked live players below synthetic seed rows,
-- because their power was null. player_names (FR-CORE-001 name history) was
-- never written at all.
--
-- Statement-level triggers with transition tables, so a 92-row roster costs
-- one pass. Newer-wins: a snapshot older than what we already recorded is
-- ignored, which matters because a replay can deliver history out of order.

create function public.apply_roster_summary()
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

-- player_snapshots carries no resolved alliance_id (server.rank names the
-- alliance without identifying it), so its summary leaves membership alone.
create function public.apply_player_summary()
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

create function public.apply_alliance_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.alliances a
  set current_name = coalesce(s.name, a.current_name),
      current_code = coalesce(s.code, a.current_code),
      power = coalesce(s.power, a.power),
      member_count = coalesce(s.member_count, a.member_count),
      last_seen_at = s.captured_at
  from (
    select distinct on (alliance_id)
      alliance_id, name, code, power, member_count, captured_at
    from new_rows
    where alliance_id is not null
    order by alliance_id, captured_at desc
  ) s
  where a.alliance_id = s.alliance_id
    and (a.last_seen_at is null or a.last_seen_at < s.captured_at);

  insert into public.alliance_names (alliance_id, name, code, first_seen_at, last_seen_at)
  select alliance_id, name, min(code), min(captured_at), max(captured_at)
  from new_rows
  where alliance_id is not null and name is not null
  group by alliance_id, name
  on conflict (alliance_id, name) do update
  set first_seen_at = least(public.alliance_names.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.alliance_names.last_seen_at, excluded.last_seen_at);

  return null;
end;
$$;

create trigger alliance_member_snapshots_summary
  after insert on public.alliance_member_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_roster_summary();

create trigger player_snapshots_summary
  after insert on public.player_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_player_summary();

-- player_detail_snapshots names its total `power_total` and carries no
-- display name, so it needs its own projection rather than the shared one.
create function public.apply_player_detail_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.players p
  set power = coalesce(s.power_total, p.power),
      server_id = coalesce(s.server_id, p.server_id),
      last_seen_at = s.captured_at
  from (
    select distinct on (player_id) player_id, power_total, server_id, captured_at
    from new_rows
    where player_id is not null
    order by player_id, captured_at desc
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);
  return null;
end;
$$;

create trigger player_detail_snapshots_summary
  after insert on public.player_detail_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_player_detail_summary();

create trigger alliance_snapshots_summary
  after insert on public.alliance_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_alliance_summary();
