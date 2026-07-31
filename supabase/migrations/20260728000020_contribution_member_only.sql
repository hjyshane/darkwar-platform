-- 0020: alliance contribution is for the alliance.
--
-- 0006 restricted alliance_member_snapshots to member+ (§17.3: "CBFW 내부
-- presence — Viewer −"). 0015 then projected the contribution scores from
-- those snapshots onto public.players, which carries `public_read ... to
-- anon, authenticated using (true)` — so daily_donation_score and
-- alliance_battle_score have been readable by anyone holding the
-- publishable key, which is in the browser bundle by design.
--
-- A lock on the Members page would not have closed this. The page is not
-- the boundary; the key reaches PostgREST directly.
--
-- Same shape of leak 0016 described for the monthly pass, and the same fix:
-- app roles all share the `authenticated` database role, so column
-- privileges cannot say "member but not viewer". Only a row-secured table
-- can, because only RLS sees current_app_role().
--
-- Moving all four columns rather than revoking them has a second benefit:
-- nothing sensitive is left on players, so the table keeps its plain
-- table-level grant. 0016 had to take column-list grants on two tables and
-- documented the cost — every future column must be granted explicitly or
-- PostgREST fails it with 42501. This avoids inheriting that.
--
-- last_seen_at deliberately stays on players. It is set from a snapshot's
-- captured_at (0008), so it says when the collector last observed the
-- player — not when they were last online. The real presence signal is
-- alliance_member_snapshots.online_state, which 0006 already restricted.

create table public.player_contributions (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  daily_donation_score bigint,
  daily_donation_updated_at timestamptz,
  alliance_battle_score bigint,
  alliance_battle_updated_at timestamptz
);

comment on table public.player_contributions is
  'Current contribution per player, member+ only. Split from public.players '
  'because that table is world-readable and this is alliance-internal.';

alter table public.player_contributions enable row level security;

-- anon is granted so a logged-out dashboard gets a clean empty result (RLS
-- filters every row) instead of 42501; the policy is what actually decides.
grant select on public.player_contributions to anon, authenticated;

create policy member_read on public.player_contributions
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

insert into public.player_contributions (
  player_id,
  daily_donation_score,
  daily_donation_updated_at,
  alliance_battle_score,
  alliance_battle_updated_at
)
select
  player_id,
  daily_donation_score,
  daily_donation_updated_at,
  alliance_battle_score,
  alliance_battle_updated_at
from public.players
where daily_donation_score is not null or alliance_battle_score is not null;

alter table public.players drop column daily_donation_score;
alter table public.players drop column daily_donation_updated_at;
alter table public.players drop column alliance_battle_score;
alter table public.players drop column alliance_battle_updated_at;

-- Same newer-wins logic as 0015, retargeted. Two passes still, because each
-- type gates on its own timestamp: a fresh daily donation must not be
-- blocked by a newer alliance-battle reading.
create or replace function public.apply_contribution_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_contributions as c (
    player_id, daily_donation_score, daily_donation_updated_at
  )
  select player_id, score, effective_at
  from (
    select distinct on (player_id)
      player_id, score,
      coalesce(score_updated_at, captured_at) as effective_at
    from new_rows
    where player_id is not null and contribution_type = 'daily_donation'
    order by player_id, coalesce(score_updated_at, captured_at) desc
  ) s
  on conflict (player_id) do update
  set daily_donation_score = coalesce(excluded.daily_donation_score, c.daily_donation_score),
      daily_donation_updated_at = excluded.daily_donation_updated_at
  where c.daily_donation_updated_at is null
     or c.daily_donation_updated_at < excluded.daily_donation_updated_at;

  insert into public.player_contributions as c (
    player_id, alliance_battle_score, alliance_battle_updated_at
  )
  select player_id, score, effective_at
  from (
    select distinct on (player_id)
      player_id, score,
      coalesce(score_updated_at, captured_at) as effective_at
    from new_rows
    where player_id is not null and contribution_type = 'alliance_battle'
    order by player_id, coalesce(score_updated_at, captured_at) desc
  ) s
  on conflict (player_id) do update
  set alliance_battle_score = coalesce(excluded.alliance_battle_score, c.alliance_battle_score),
      alliance_battle_updated_at = excluded.alliance_battle_updated_at
  where c.alliance_battle_updated_at is null
     or c.alliance_battle_updated_at < excluded.alliance_battle_updated_at;

  -- last_seen_at still belongs to players: it records that we observed the
  -- player at all, which is not contribution and not restricted.
  update public.players p
  set last_seen_at = greatest(coalesce(p.last_seen_at, s.captured_at), s.captured_at)
  from (
    select player_id, max(captured_at) as captured_at
    from new_rows
    where player_id is not null
    group by player_id
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);

  return null;
end;
$$;
