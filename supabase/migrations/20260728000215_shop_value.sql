-- 0215: what packs and shop entries are worth (item 3).
--
-- THE PACKS come from `exchange.info`: every pack the server offers this
-- account — price in dollars, the rubies it includes, its items, its window,
-- and the game's own "value %" claim. THE SHOPS come from `user.get.shop.info`:
-- one shop type per response, each listing an item, a quantity and a price in
-- some currency. normalize/shop.py writes both; per-account fields (bought,
-- buy counts, choices made) are stripped first, so the key is the offer itself.
--
-- ITEM VALUES are rubies per unit, from three sources, highest first:
--   officer    typed by an officer or admin; never overwritten by the tool
--   game       the client's goods.price, which equals the Ruby shop's list
--              price for every item that shop sells (checked 2026-10-03)
--   estimated  back-solved from the game's value % on the packs an item
--              appears in, with the game-priced items held fixed
-- VIP Points are 0 by decision (2026-10-03): a bonus, not value. The game
-- prices them at 10-500 rubies, which would inflate every pack.
--
-- ONE RUBY IS $0.0099: every ruby-only pack is 100 rubies per $0.99.

create table public.shop_pack_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  server_id int not null references public.servers (server_id),
  pack_id text not null,
  name_key text,
  pack_type text,
  dollars numeric(10, 2) not null,
  rubies int not null default 0,
  claimed_percent int,
  -- [{"id": "230110", "qty": 10}, ...]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  starts_at timestamptz,
  ends_at timestamptz
);

create index shop_pack_snapshots_pack_idx
  on public.shop_pack_snapshots (server_id, pack_id, captured_at desc);

create table public.shop_listing_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  server_id int not null references public.servers (server_id),
  shop_type int not null,
  listing_id text not null,
  item_id text,
  qty int not null default 1,
  -- currency "1;15" is resource 15 (Ruby); "2;252039" is item 252039.
  currency_kind int,
  currency_id text,
  price int not null,
  discount numeric
);

create index shop_listing_snapshots_listing_idx
  on public.shop_listing_snapshots (server_id, shop_type, listing_id, captured_at desc);

create table public.game_item_values (
  item_id text primary key check (item_id ~ '^[0-9]+$'),
  rubies numeric not null check (rubies >= 0),
  source text not null check (source in ('officer', 'game', 'estimated')),
  note text check (note is null or length(note) <= 300),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.game_item_values is
  'Rubies per unit for pricing packs and shop entries (0215). source: officer '
  '(typed, never overwritten), game (goods.price = Ruby shop list price), '
  'estimated (back-solved from pack value %). VIP Points are 0 by decision.';

-- Localised strings the pack report needs and no other table carries: pack
-- names, which the server sends as a localisation key. Written by
-- `dw-collector game-values` for the keys the journal's packs use.
create table public.game_strings (
  string_key text primary key check (string_key ~ '^[0-9]+$'),
  en text,
  ko text,
  updated_at timestamptz not null default now()
);

create trigger game_item_values_set_updated_at
  before update on public.game_item_values
  for each row execute function public.set_updated_at();

-- An officer's value is theirs: any write by a signed-in user marks it
-- 'officer', so `dw-collector game-values` (the service key, no auth.uid())
-- leaves it alone on the next run. Same rule as event_names (0210).
create function internal.game_item_values_mark_officer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.source := 'officer';
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger game_item_values_mark_officer
  before insert or update on public.game_item_values
  for each row execute function internal.game_item_values_mark_officer();

do $$
declare
  t text;
begin
  foreach t in array array['shop_pack_snapshots', 'shop_listing_snapshots', 'game_item_values',
                           'game_strings'] loop
    execute format('alter table public.%I enable row level security', t);
    -- revoke-then-grant: hosted default privileges give authenticated all (0207).
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy member_read on public.%I for select to authenticated '
      'using ((select public.current_app_role()) in (''member'', ''officer'', ''admin''))', t);
  end loop;
end;
$$;

grant insert, update, delete on public.game_item_values to authenticated;

create policy officer_insert on public.game_item_values
  for insert to authenticated
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_update on public.game_item_values
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_delete on public.game_item_values
  for delete to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));

-- ---------------------------------------------------------------------------
-- Every pack as last seen, valued. One row per pack per server (about 450),
-- far under PostgREST's 1,000.

create view public.shop_pack_value
with (security_invoker = true)
as
with latest as (
  select distinct on (p.server_id, p.pack_id) p.*
    from public.shop_pack_snapshots p
   order by p.server_id, p.pack_id, p.captured_at desc
),
priced as (
  select
    l.server_id,
    l.pack_id,
    coalesce(sum((i.qty)::numeric * v.rubies), 0) as item_rubies,
    count(*) filter (where v.item_id is null) as unvalued_items,
    jsonb_agg(
      jsonb_build_object(
        'id', i.id, 'qty', i.qty,
        'name', gi.name, 'name_ko', gi.name_ko,
        'rubies', v.rubies, 'source', v.source)
      order by coalesce(i.qty * v.rubies, 0) desc
    ) filter (where i.id is not null) as contents
  from latest l
  left join lateral jsonb_to_recordset(l.items) as i(id text, qty numeric) on true
  left join public.game_item_values v on v.item_id = i.id
  left join public.game_items gi on gi.item_id = i.id
  group by l.server_id, l.pack_id
)
select
  l.server_id,
  l.pack_id,
  l.name_key,
  coalesce(gs.en, 'Pack #' || l.pack_id) as name,
  gs.ko as name_ko,
  l.pack_type,
  l.dollars,
  l.rubies,
  l.claimed_percent,
  l.starts_at,
  l.ends_at,
  l.captured_at,
  p.item_rubies,
  p.unvalued_items,
  coalesce(p.contents, '[]'::jsonb) as contents,
  -- 1 ruby = $0.0099 (100 per $0.99).
  round((l.rubies + p.item_rubies) * 0.0099, 2) as value_dollars,
  case when l.dollars > 0
       then round((l.rubies + p.item_rubies) * 0.0099 / l.dollars, 2)
  end as value_ratio
from latest l
join priced p using (server_id, pack_id)
left join public.game_strings gs on gs.string_key = l.name_key;

comment on view public.shop_pack_value is
  'Every pack as last seen per server, valued: rubies included plus items at '
  'game_item_values, in dollars at 100 rubies per $0.99, and value_ratio = '
  'value / price. unvalued_items counts contents with no value yet (0215).';

revoke all on public.shop_pack_value from anon;
grant select on public.shop_pack_value to authenticated;
