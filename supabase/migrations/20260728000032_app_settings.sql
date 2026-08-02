-- 0032: settings an admin can change without a deploy, starting with which
-- alliance is ours.
--
-- 0031 derived that from the payload — an al.rank response that reports real
-- presence is one the collector is a member of — and that stays. It is an
-- observation, it is usually right, and it is the only answer available on a
-- fresh install before anyone has configured anything.
--
-- What it cannot do is be overruled. The collector account can be moved, a
-- second roster can be captured while helping another alliance, and the
-- evidence then says two things at once. Someone has to be able to state the
-- answer, and that someone is an admin rather than a migration: alliance_id
-- is generated per install, so pinning CBFW here would be pinning a uuid
-- this file cannot know.
--
-- So the two are separated rather than merged:
--
--   roster_unredacted_seen  what we OBSERVED     (0031's rule, unchanged)
--   is_own                  what we BELIEVE      (the pin if set, else the above)
--
-- Keeping the observation under its own name is the point. Overwriting it
-- with an admin's answer would destroy the evidence that the answer disagrees
-- with, and "the admin says CBFW but every roster we hold is someone else's"
-- is exactly the thing worth being able to notice.

alter table public.alliances
  rename column is_own to roster_unredacted_seen;

-- The index follows the column through the rename but keeps its old name,
-- which would then read as an index on a column that no longer exists.
alter index public.alliances_is_own_idx rename to alliances_roster_unredacted_idx;

comment on column public.alliances.roster_unredacted_seen is
  'We have seen a roster for this alliance WITH real presence. The game '
  'redacts presence for alliances the viewer is not in, so this is evidence '
  'of membership. Written only by apply_roster_summary; never by hand, and '
  'never overwritten by the admin pin — see is_own.';

alter table public.alliances
  add column is_own boolean not null default false;

comment on column public.alliances.is_own is
  'Whether the dashboard treats this as our alliance. Resolved from the pin '
  'in app_settings when one is set, otherwise from roster_unredacted_seen. '
  'Maintained by resolve_own_alliance(); do not write it directly.';

create index alliances_is_own_idx on public.alliances (is_own) where is_own;

-- Small, typed-by-convention key/value. Not a column per setting: the next
-- three settings are already known to be a metric list, a formula set and an
-- announcement, none of which are a scalar.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on table public.app_settings is
  'Runtime configuration an admin can change without a deploy. World-readable '
  'because the dashboard renders from it; admin-writable only.';

alter table public.app_settings enable row level security;
grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;

-- Readable by everyone: the overview has to render for a logged-out viewer,
-- and which alliance is ours is not a secret — the roster's figures behind it
-- are, and those have their own policies.
create policy public_read on public.app_settings
  for select to anon, authenticated using (true);

create policy admin_write on public.app_settings
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- The resolution rule, in one place so the app never has to reimplement it.
create function public.resolve_own_alliance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pinned uuid;
begin
  select (value ->> 'alliance_id')::uuid into pinned
  from public.app_settings where key = 'own_alliance';

  if pinned is not null then
    -- An explicit answer wins outright, including over evidence. That is what
    -- makes it useful: the case for having it at all is the case where the
    -- observation is wrong.
    update public.alliances
    set is_own = (alliance_id = pinned)
    where is_own <> (alliance_id = pinned);
  else
    update public.alliances
    set is_own = roster_unredacted_seen
    where is_own <> roster_unredacted_seen;
  end if;
end;
$$;

comment on function public.resolve_own_alliance is
  'Recompute alliances.is_own from the admin pin, falling back to what the '
  'rosters show. Called by apply_roster_summary and by the settings trigger, '
  'so the two inputs cannot drift apart.';

create function public.app_settings_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the one key affects it today; guarding keeps a future setting from
  -- silently re-running this on every save.
  if coalesce(new.key, old.key) = 'own_alliance' then
    perform public.resolve_own_alliance();
  end if;
  return null;
end;
$$;

create trigger app_settings_resolve_own
  after insert or update or delete on public.app_settings
  for each row execute function public.app_settings_resolve();

-- Same body as 0031 with the observation writing to its own column and the
-- resolution called at the end. Carried forward whole — 0024 warned that
-- rebuilding this function from an older definition silently reverts the
-- month-card and presence blocks, and they are both still here.
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

  -- The observation. Only ever set true: opening someone else's roster later
  -- must not unmark ours, and leaving an alliance is not something a roster
  -- response says.
  update public.alliances a
  set roster_unredacted_seen = true
  where not a.roster_unredacted_seen
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

  -- Last, so a newly observed alliance is reflected in the same statement
  -- rather than waiting for the next capture.
  perform public.resolve_own_alliance();

  return null;
end;
$$;

-- Seed is_own from what 0031 already established, so an install that has
-- never set a pin behaves exactly as it did before this migration.
select public.resolve_own_alliance();
