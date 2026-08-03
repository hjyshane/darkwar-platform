-- 0066: a member's own history, and the column that makes "own" expressible.
--
-- 0006 drew the line at role >= member and said why, right above the policy:
--
--   "Members to their own alliance needs game_identity_links, which is
--    deferred — until then the line is drawn at role >= member."
--
-- This is the deferred half. `game_identity_links` (§6.2) is still blocked
-- on a capture nobody has taken, so the link is made by hand instead of by
-- the in-game message flow: an admin picks which player an account is, on a
-- screen that already edits app_users rows.
--
-- The important property is that a member CANNOT make that claim themselves.
-- app_users.self_read is select-only and every write goes through
-- `manage_write` (0045, capability members.manage). If self-service linking
-- were possible, anyone could declare themselves anyone and read their
-- history — the whole gate would be decorative.
--
-- NOT a capability, deliberately. 0045 drew this distinction and it still
-- holds: read gates on snapshot tables name roles directly because they say
-- "alliance business is not public", which is a property of the data rather
-- than a switch to flip from a settings page. 0063 added the registry's one
-- read capability and was careful to say it decides whether a screen is
-- OFFERED, not what may be read. Making this one a capability would put
-- "can every member read every member's history" on a grid of checkboxes,
-- one mis-click from undoing the thing this migration is for.

alter table public.app_users
  add column player_id uuid references public.players (player_id)
    on delete set null;

comment on column public.app_users.player_id is
  'Which player this account is, set by an admin (members.manage). Null '
  'until somebody links it, and null is what a member''s own history gate '
  'evaluates against — an unlinked account is nobody and reads nothing. '
  'When the §6.2 identity flow finally lands it fills THIS column; it is '
  'not a stand-in that gets thrown away.';

-- One account per player and one player per account. Partial, because null
-- means unlinked and any number of accounts may be unlinked.
create unique index app_users_player_id_uniq
  on public.app_users (player_id) where player_id is not null;

-- SECURITY DEFINER for exactly the reason current_app_role() and
-- has_permission() are: it reads a table from inside a policy and must not
-- recurse through that table's own RLS.
create function public.linked_player_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select player_id from public.app_users where user_id = (select auth.uid())
$$;

revoke all on function public.linked_player_id() from public;
grant execute on function public.linked_player_id() to authenticated;

comment on function public.linked_player_id() is
  'The player the caller is, or null when their account has never been '
  'linked. Null denies rather than matches: `player_id = null` is null, '
  'not true, at every call site.';

-- The gate itself.
--
-- Enumerated rather than compared: app_role sorts collector_service and
-- analyst_service ABOVE admin, so `>= 'officer'` would quietly hand the
-- whole alliance's history to the two service roles.
drop policy member_read on public.alliance_member_snapshots;

create policy own_or_officer_read on public.alliance_member_snapshots
  for select to authenticated
  using (
    public.current_app_role() in ('officer', 'admin')
    or player_id = public.linked_player_id()
  );

-- No grant changes and no new index. 0016's column-list grant already covers
-- what the screen reads (captured_at, player_id, member_rank, power, kills,
-- presence_redacted, online_state) and deliberately withholds
-- month_card_expires_at and raw, which stay withheld here. 0003's
-- (player_id, captured_at desc) index is exactly what both the policy
-- predicate and the history query filter on.
--
-- Nothing else in the schema reads this table through RLS: 0030 and 0031
-- touch it in migration-time backfills and inside apply_roster_summary(),
-- which is SECURITY DEFINER, and no view selects from it. The collector
-- writes with the service key and bypasses policies entirely.
