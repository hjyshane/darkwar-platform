-- 0057: the rank a member holds in the game, on the member.
--
-- 0045 gave app_users a game_rank, and that one is about a DASHBOARD
-- ACCOUNT. Most of the roster has never signed in — 93 members against a
-- handful of accounts — so it cannot answer "what rank is this member".
-- This column can, because it is on the player.
--
-- Two sources, in order:
--
--   assigned_rank        what an admin set. Wins.
--   the latest period's  what build_rank_period worked out. R1-R3 only:
--   computed tier        R4 and R5 are limited seats handed out by hand,
--                        and a formula has no business claiming one.
--
-- Column-level GRANT rather than a row policy alone. RLS decides which ROWS
-- a statement may touch and has nothing to say about which COLUMNS, so an
-- update policy on players would have let anyone who can set a rank also
-- rewrite power, kills and the alliance link. Granting update on the single
-- column is the part of this that actually constrains it.
alter table public.players
  add column assigned_rank text
    check (assigned_rank is null or assigned_rank in ('R1', 'R2', 'R3', 'R4', 'R5'));

comment on column public.players.assigned_rank is
  'The rank an admin set for this member, overriding the computed one. Null '
  'means "use what the last period worked out".';

grant update (assigned_rank) on public.players to authenticated;

create policy set_rank on public.players
  for update to authenticated
  using (public.has_permission('members.manage'))
  with check (public.has_permission('members.manage'));

-- The most recent period each member was ranked in. A view rather than a
-- column on players: the tier is a fact about a period, and copying it onto
-- the player would need rewriting every time a period is rebuilt.
create view public.player_current_rank
with (security_invoker = true) as
select distinct on (player_id)
  player_id,
  period_start,
  tier as computed_tier,
  tier_reason as computed_reason
from public.rank_period_snapshots
order by player_id, period_start desc;

comment on view public.player_current_rank is
  'The tier the newest period gave each member. security_invoker, so the '
  'member-only policy on rank_period_snapshots still decides who sees it.';

grant select on public.player_current_rank to authenticated;
