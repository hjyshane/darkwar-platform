-- 0059: the rank moves off the public table, because it was leaking.
--
-- 0057 put assigned_rank on `players`, which carries `public_read USING
-- (true)`. Every figure a rank is DERIVED from — donation, duel, presence —
-- is member-only, and the conclusion drawn from them was readable logged
-- out. Worse, it was readable inconsistently: the computed tier came from
-- rank_period_snapshots and stayed member-only, so a viewer saw a rank for
-- the handful of members somebody had set by hand and a blank for everyone
-- else, with nothing on screen to say why.
--
-- Column privileges cannot fix this. GRANT works on columns but not on
-- roles-within-a-table: revoking the column from `authenticated` would take
-- it from members too, and RLS, which CAN tell a member from a viewer, has
-- nothing to say about columns. So the rank moves to a table of its own,
-- where a row policy is the right shape for the question.
create table public.player_ranks (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  assigned_rank text not null
    check (assigned_rank in ('R1', 'R2', 'R3', 'R4', 'R5')),
  set_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

comment on table public.player_ranks is
  'The rank an admin set for a member, overriding the computed one. Its own '
  'table rather than a column on players because players is world-readable '
  'and this is alliance business — the figures it is derived from are all '
  'member-only.';

insert into public.player_ranks (player_id, assigned_rank)
select player_id, assigned_rank from public.players where assigned_rank is not null;

alter table public.players drop column assigned_rank;
drop policy set_rank on public.players;

alter table public.player_ranks enable row level security;
grant select on public.player_ranks to authenticated;
grant insert, update, delete on public.player_ranks to authenticated;
grant all on public.player_ranks to service_role;

-- Same audience as every other alliance figure on the roster.
create policy member_read on public.player_ranks
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

create policy manage_write on public.player_ranks
  for all to authenticated
  using (public.has_permission('members.manage'))
  with check (public.has_permission('members.manage'));

-- An author field the author can write is not an author field (0033).
create function public.player_ranks_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.set_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger player_ranks_set_actor
  before insert or update on public.player_ranks
  for each row execute function public.player_ranks_set_actor();

-- One member-only place the roster asks, so both halves of a rank arrive
-- together or neither does. A member with no period yet but a hand-set rank
-- still appears, which a join off rank_period_snapshots alone would miss.
drop view public.player_current_rank;

create view public.player_current_rank
with (security_invoker = true) as
select
  coalesce(latest.player_id, assigned.player_id) as player_id,
  assigned.assigned_rank,
  latest.period_start,
  latest.tier as computed_tier,
  latest.tier_reason as computed_reason,
  latest.activity_score as rank_score,
  latest.donation_pct,
  latest.duel_pct,
  latest.growth_pct
from (
  select distinct on (player_id) *
  from public.rank_period_snapshots
  order by player_id, period_start desc
) as latest
full join public.player_ranks as assigned using (player_id);

comment on view public.player_current_rank is
  'What an admin set and what the last period worked out, for each member. '
  'security_invoker: both sides are member-only and stay that way.';

grant select on public.player_current_rank to authenticated;
