-- 0092: what a member is paying for, visible from officer up.
--
-- WHAT THE GAME ACTUALLY TELLS US. `get.user.info.multi` carries `monthCardEndTime`,
-- `vipLevel`, `vipEndTime` and `svipLevel`, and nothing else about spending. There
-- is NO weekly card, battle pass, hero pass or dawn pass field in the payload —
-- those were asked for and they are not there, so nothing here pretends to know
-- them. If one turns up in a future response it lands in `raw` and gets promoted
-- then (§11.2), which is the point of keeping raw.
--
-- WHY NOT A TYPED COLUMN ON player_snapshots. 0016 closed the monthly pass by
-- moving current state to its own row-secured table and revoking `raw` and the
-- typed column from client roles, because app roles share one database role and a
-- column grant cannot tell an officer from a member. A typed `vip_level` on
-- `player_snapshots` would have exactly the problem 0016 solved: grant it and
-- every member reads it, withhold it and PostgREST fails for everyone. So VIP
-- follows the monthly pass: a secured table of current state, filled by a trigger
-- that reads `raw`, which clients cannot read at all.
--
-- WHY OFFICER RATHER THAN ADMIN. Who is paying is a fact officers use when they
-- decide who to keep in limited seats, and the alliance runs on officers, not on
-- one admin. Plain members still see none of it — this is a widening of 0016's
-- audience, not an abandonment of it.

create table public.player_vip (
  player_id uuid primary key references public.players (player_id) on delete cascade,
  -- Nullable rather than 0: a reading that did not carry the field is not a
  -- player at VIP 0 (FR-UI-008), and the two are told apart on screen.
  vip_level integer,
  vip_expires_at timestamptz,
  -- A separate ladder in the game, and separately priced. Kept apart rather than
  -- folded into vip_level, which would silently claim they are the same scale.
  svip_level integer,
  -- When the reading that set these was captured; the newer-wins gate, same as
  -- player_month_cards.
  observed_at timestamptz not null
);

comment on table public.player_vip is
  'Current VIP standing per player, from get.user.info.multi. Its own table for '
  'the same reason player_month_cards is: app roles share one database role, so '
  'only RLS can say "officer" and a column grant cannot.';

alter table public.player_vip enable row level security;

-- NOT anon. 0016 granted anon so a non-admin page would see an empty result
-- rather than an error, but 0065 closed the whole schema to signed-out readers
-- and `34_no_public_read_test` enforces it — which is how this migration's first
-- draft was caught. A signed-in member still gets a clean empty result, because
-- they are `authenticated` and RLS filters every row; a signed-out reader gets
-- 42501, which is the answer 0065 wants.
grant select on public.player_vip to authenticated;
grant all on public.player_vip to service_role;

create policy officer_read on public.player_vip
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));

-- The monthly pass joins it at the same audience. Dropped and recreated rather
-- than altered: a policy's USING clause cannot be changed in place.
drop policy admin_read on public.player_month_cards;

create policy officer_read on public.player_month_cards
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));

-- ---------------------------------------------------------------------------
-- Filling it.
--
-- From `raw`, not from a typed column, because there is no typed column and
-- deliberately so (above). The function is SECURITY DEFINER, which is what lets
-- it read a column revoked from every client role.
--
-- The epoch sentinels are the same ones the parser already folds for the monthly
-- pass: the game writes 0 for "never had one" and a past timestamp for "expired",
-- and only the first of those is an absence. An expired date is a fact worth
-- keeping — it says they used to pay.
create function public.apply_vip_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_vip as pv (
    player_id, vip_level, vip_expires_at, svip_level, observed_at
  )
  select distinct on (player_id)
    player_id,
    nullif((raw ->> 'vipLevel')::integer, -1),
    case
      when coalesce((raw ->> 'vipEndTime')::bigint, 0) > 0
        then to_timestamp((raw ->> 'vipEndTime')::bigint)
    end,
    nullif((raw ->> 'svipLevel')::integer, -1),
    captured_at
  from new_rows
  where player_id is not null
    and source_command = 'get.user.info.multi'
    -- A response that carries neither is not a response about VIP, and must not
    -- overwrite a known standing with nulls.
    and (raw ? 'vipLevel' or raw ? 'vipEndTime')
  order by player_id, captured_at desc
  on conflict (player_id) do update
    set vip_level = excluded.vip_level,
        vip_expires_at = excluded.vip_expires_at,
        svip_level = excluded.svip_level,
        observed_at = excluded.observed_at
    -- Newer wins, and a replay of an older capture changes nothing.
    where pv.observed_at < excluded.observed_at;
  return null;
end;
$$;

create trigger apply_vip_from_profile
  after insert on public.player_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_vip_from_profile();

-- Everything already captured, by the same rule.
insert into public.player_vip (player_id, vip_level, vip_expires_at, svip_level, observed_at)
select distinct on (player_id)
  player_id,
  nullif((raw ->> 'vipLevel')::integer, -1),
  case
    when coalesce((raw ->> 'vipEndTime')::bigint, 0) > 0
      then to_timestamp((raw ->> 'vipEndTime')::bigint)
  end,
  nullif((raw ->> 'svipLevel')::integer, -1),
  captured_at
from public.player_snapshots
where player_id is not null
  and source_command = 'get.user.info.multi'
  and (raw ? 'vipLevel' or raw ? 'vipEndTime')
order by player_id, captured_at desc
on conflict (player_id) do nothing;

-- ---------------------------------------------------------------------------
-- One place for the dashboard to ask.
--
-- security_invoker, so the two policies above decide what comes back: an officer
-- gets rows, a member gets none, and the screen shows a dash rather than being
-- told a lie or shown an error. The gate is in SQL, not in React — a column the
-- client merely declines to draw is still a column the client received.
create view public.player_subscriptions
with (security_invoker = true) as
select
  coalesce(mc.player_id, v.player_id) as player_id,
  mc.expires_at as month_card_expires_at,
  mc.observed_at as month_card_observed_at,
  v.vip_level,
  v.vip_expires_at,
  v.svip_level,
  v.observed_at as vip_observed_at
from public.player_month_cards mc
full join public.player_vip v using (player_id);

comment on view public.player_subscriptions is
  'The monthly pass and VIP standing together, for officers and admins. A '
  'member''s query returns no rows at all rather than nulls — the difference '
  'between "we do not know" and "you may not ask" stays visible to the caller.';

grant select on public.player_subscriptions to authenticated;
