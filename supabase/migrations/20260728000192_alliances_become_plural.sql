-- 0192: the schema learns that "our alliance" can be more than one.
--
-- Plan: docs/superpowers/plans/2026-09-28-multi-alliance.md. This is phase 1
-- of 5 and it changes NOTHING anyone can see. Every piece here is additive,
-- and every piece is defaulted so today's single-alliance install behaves
-- exactly as it did:
--
--   * own_alliance accepts a LIST (`alliance_ids`). The old single
--     `alliance_id` is still read, and the dashboard still writes it. Until
--     phase 5 the list must hold one id: the ten-odd views that filter
--     `is_own` do not partition by alliance yet, and a second own alliance
--     today would merge two rosters, two rank tables and two boards into one.
--
--   * alliance_memberships is who belongs WHERE, with a role per alliance.
--     It is backfilled from app_users.role and mirrored from it by trigger,
--     because app_users.role is still what current_app_role() reads. Phase 2
--     flips that: memberships become the source and the mirror goes away.
--
--   * alliance_id lands on the tables people write into — join codes,
--     claims, notices, guides, the schedule, hive formations and templates.
--     Backfilled to the pinned alliance and defaulted to it, so an insert
--     that does not know the column exists still lands in the right place.
--     Nullable on purpose: a fresh install with nothing pinned has no
--     alliance to default to, and the pgTAP suite builds exactly that.
--
-- Deliberately NOT here: hive_map_features (a building's size is a fact
-- about the game, not about an alliance) and the derived tables
-- (rank_period_snapshots, member_roster_current, ...), whose writers have to
-- be rewritten to partition and belong to phase 4.

-- The first own alliance, in pin order. What an alliance-less insert means
-- while there is only one, and the fallback active alliance later.
create function public.primary_own_alliance()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value -> 'alliance_ids' ->> 0)::uuid
       from public.app_settings s where s.key = 'own_alliance'),
    (select (s.value ->> 'alliance_id')::uuid
       from public.app_settings s where s.key = 'own_alliance'),
    (select a.alliance_id from public.alliances a
      where a.is_own order by a.alliance_id limit 1))
$$;

revoke all on function public.primary_own_alliance() from public;
grant execute on function public.primary_own_alliance() to anon, authenticated, service_role;

comment on function public.primary_own_alliance is
  'The first own alliance: first of the pinned list, else the legacy single '
  'pin, else the lowest is_own row. Column default for alliance_id on '
  'alliance-owned tables; never a permission check.';

-- Same rule as 0032, reading a list. The legacy `alliance_id` form is folded
-- in so an install that never re-saves the setting keeps its pin.
create or replace function public.resolve_own_alliance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
  pinned uuid[];
begin
  select value into v_value
  from public.app_settings where key = 'own_alliance';

  if v_value ? 'alliance_ids' then
    select array_agg(e::uuid) into pinned
    from jsonb_array_elements_text(v_value -> 'alliance_ids') as e;
  elsif v_value ->> 'alliance_id' is not null then
    pinned := array[(v_value ->> 'alliance_id')::uuid];
  end if;

  if pinned is not null and cardinality(pinned) > 0 then
    update public.alliances
    set is_own = (alliance_id = any (pinned))
    where is_own <> (alliance_id = any (pinned));
  else
    update public.alliances
    set is_own = roster_unredacted_seen
    where is_own <> roster_unredacted_seen;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who belongs where.

create table public.alliance_memberships (
  user_id uuid not null references public.app_users (user_id) on delete cascade,
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade,
  -- Admin is global and lives on app_users; a membership is only ever the
  -- two roles a join code can grant.
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, alliance_id),
  constraint alliance_memberships_role check (role in ('member', 'officer'))
);

create index alliance_memberships_alliance_idx
  on public.alliance_memberships (alliance_id, role);

comment on table public.alliance_memberships is
  'Which own alliances a dashboard account belongs to, and as what. Admin is '
  'not a membership — it is global, on app_users. Until phase 2 of the '
  'multi-alliance plan this is mirrored FROM app_users.role; do not write it '
  'directly yet.';

alter table public.alliance_memberships enable row level security;
grant select on public.alliance_memberships to authenticated;
grant all on public.alliance_memberships to service_role;

-- You may see your own; whoever manages members may see all. Writes go
-- through the mirror trigger (definer) until phase 2 gives them a real path.
create policy own_or_manager_read on public.alliance_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('members.manage')));

create trigger alliance_memberships_set_updated_at
  before update on public.alliance_memberships
  for each row execute function public.set_updated_at();

insert into public.alliance_memberships (user_id, alliance_id, role)
select u.user_id, public.primary_own_alliance(), u.role
from public.app_users u
where u.role in ('member', 'officer')
  and public.primary_own_alliance() is not null;

-- The mirror. app_users.role is still authoritative, so a membership in the
-- primary alliance follows it: member/officer upserts, anything else drops
-- it. Only the primary alliance, because that is the only one app_users.role
-- has ever described.
create function public.app_users_mirror_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.primary_own_alliance();
begin
  if v_alliance is null then
    return null;
  end if;

  if new.role in ('member', 'officer') then
    insert into public.alliance_memberships (user_id, alliance_id, role)
    values (new.user_id, v_alliance, new.role)
    on conflict (user_id, alliance_id) do update set role = excluded.role
    where public.alliance_memberships.role <> excluded.role;
  else
    delete from public.alliance_memberships
    where user_id = new.user_id and alliance_id = v_alliance;
  end if;
  return null;
end;
$$;

revoke all on function public.app_users_mirror_membership() from public, anon, authenticated;

create trigger app_users_mirror_membership
  after insert or update of role on public.app_users
  for each row execute function public.app_users_mirror_membership();

-- ---------------------------------------------------------------------------
-- alliance_id on what people write.

alter table public.join_codes
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.player_claims
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.announcements
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.guides
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.schedule_categories
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.schedule_events
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.hive_formations
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();
alter table public.hive_formation_templates
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.primary_own_alliance();

-- No backfill UPDATE: ADD COLUMN evaluates a non-volatile default once and
-- stores it for every existing row, which is the pinned alliance today.

create index join_codes_alliance_idx on public.join_codes (alliance_id);
create index player_claims_alliance_idx on public.player_claims (alliance_id);
create index announcements_alliance_idx on public.announcements (alliance_id);
create index guides_alliance_idx on public.guides (alliance_id);
create index schedule_categories_alliance_idx on public.schedule_categories (alliance_id);
create index schedule_events_alliance_idx on public.schedule_events (alliance_id);
create index hive_formations_alliance_idx on public.hive_formations (alliance_id);
create index hive_formation_templates_alliance_idx on public.hive_formation_templates (alliance_id);
