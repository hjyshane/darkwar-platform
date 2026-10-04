-- 0223: an account's state typed in by hand, for characters the collector
-- never sees log in.
--
-- account_state_snapshots (0205) only ever holds accounts that log in on the
-- capture PC — two of them. Every other member who wants the planner has to
-- type their levels, buffs and stock in. One row per character, the same
-- shapes as the login's columns, so the planner reads either the same way:
--   buildings        {"<bId>": level}
--   science          {"<researchId>": level}
--   hero_intensify   {"<heroId>": level}
--   hero_equips      [{equipId, heroId, level, promote}]
--   hero_exclusives  {"<heroId>": level}
--   items            {"<itemId>": count}
--   resources        {"<resourceId>": amount}
--   effects          {"<effectId>": value}   (30070, 30071, 30421)
--
-- A login, when there is one, wins: the planner uses this row only for a
-- character with no account_state_latest row.
--
-- WHO. The member who claimed the character (user_players) reads and writes
-- it, and so does anyone holding data.enter (officers and admins by default)
-- — the user's choice (2026-10-04), so an officer can enter a member's levels
-- for them. Login state (0205) stays owner-or-admin: that is the account's
-- whole inventory as the game sent it; this is what someone chose to type.

create table public.account_state_manual (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  buildings jsonb not null default '{}'::jsonb check (jsonb_typeof(buildings) = 'object'),
  science jsonb not null default '{}'::jsonb check (jsonb_typeof(science) = 'object'),
  hero_intensify jsonb not null default '{}'::jsonb
    check (jsonb_typeof(hero_intensify) = 'object'),
  hero_equips jsonb not null default '[]'::jsonb check (jsonb_typeof(hero_equips) = 'array'),
  hero_exclusives jsonb not null default '{}'::jsonb
    check (jsonb_typeof(hero_exclusives) = 'object'),
  items jsonb not null default '{}'::jsonb check (jsonb_typeof(items) = 'object'),
  resources jsonb not null default '{}'::jsonb check (jsonb_typeof(resources) = 'object'),
  effects jsonb not null default '{}'::jsonb check (jsonb_typeof(effects) = 'object'),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.account_state_manual is
  'An account''s levels, gear, buffs and stock typed in by hand for the '
  'material planner (0223), for characters with no login the collector saw. '
  'Owner (user_players) or data.enter reads and writes.';

create function public.can_enter_account(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('data.enter')
      or exists (
        select 1 from public.user_players up
        where up.player_id = p_player_id
          and up.user_id = (select auth.uid())
      )
$$;

comment on function public.can_enter_account(uuid) is
  'Whether the caller may read and write a character''s hand-entered planner '
  'state: its owner, or data.enter (0223).';

revoke all on function public.can_enter_account(uuid) from public, anon;
grant execute on function public.can_enter_account(uuid) to authenticated, service_role;

create function public.touch_account_state_manual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.touch_account_state_manual() from public, anon, authenticated;

create trigger account_state_manual_touch
  before insert or update on public.account_state_manual
  for each row execute function public.touch_account_state_manual();

alter table public.account_state_manual enable row level security;
revoke all on public.account_state_manual from anon, authenticated;
grant select, insert, update, delete on public.account_state_manual to authenticated;
grant all on public.account_state_manual to service_role;

create policy owner_or_enterer_read on public.account_state_manual
  for select to authenticated
  using (public.can_enter_account(player_id));

create policy owner_or_enterer_insert on public.account_state_manual
  for insert to authenticated
  with check (public.can_enter_account(player_id));

create policy owner_or_enterer_update on public.account_state_manual
  for update to authenticated
  using (public.can_enter_account(player_id))
  with check (public.can_enter_account(player_id));

create policy owner_or_enterer_delete on public.account_state_manual
  for delete to authenticated
  using (public.can_enter_account(player_id));
