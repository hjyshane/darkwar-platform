-- 0216: a pass is not worth nothing.
--
-- 135 of the 536 paid packs — battle passes, growth passes, login gifts —
-- list no items and no rubies in `exchange.info`: they pay out over levels
-- or days, from tables the pack list does not carry. 0215 valued them at
-- $0 and ranked them last as the worst buys, which is a claim the data
-- cannot make. Their value and ratio are now null, and contents_listed says
-- why. The rest of the view is 0215's.
--
-- And item names officers correct (game_item_names), shown in both views.

-- ITEM NAMES officers can correct. game_items is the game's and
-- `game-catalog` overwrites it on every run, so a correction lives here and
-- wins wherever an item is shown. The item code is the key and never changes.
create table public.game_item_names (
  item_id text primary key check (item_id ~ '^[0-9]+$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.game_item_names is
  'Officer corrections to item names (0216). Shown instead of game_items.name; '
  'the game catalogue never overwrites them.';

create trigger game_item_names_set_updated_at
  before update on public.game_item_names
  for each row execute function public.set_updated_at();

alter table public.game_item_names enable row level security;
revoke all on public.game_item_names from anon, authenticated;
grant select, insert, update, delete on public.game_item_names to authenticated;
grant all on public.game_item_names to service_role;

create policy member_read on public.game_item_names
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy officer_insert on public.game_item_names
  for insert to authenticated
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_update on public.game_item_names
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_delete on public.game_item_names
  for delete to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));

create or replace view public.shop_pack_value
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
        'name', coalesce(nm.name, gi.name), 'name_ko', gi.name_ko,
        'rubies', v.rubies, 'source', v.source)
      order by coalesce(i.qty * v.rubies, 0) desc
    ) filter (where i.id is not null) as contents
  from latest l
  left join lateral jsonb_to_recordset(l.items) as i(id text, qty numeric) on true
  left join public.game_item_values v on v.item_id = i.id
  left join public.game_items gi on gi.item_id = i.id
  left join public.game_item_names nm on nm.item_id = i.id
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
  -- 1 ruby = $0.0099 (100 per $0.99). Null, not zero, for a pack whose
  -- contents the pack list does not carry (0216).
  case when jsonb_array_length(l.items) > 0 or l.rubies > 0
       then round((l.rubies + p.item_rubies) * 0.0099, 2)
  end as value_dollars,
  case when l.dollars > 0 and (jsonb_array_length(l.items) > 0 or l.rubies > 0)
       then round((l.rubies + p.item_rubies) * 0.0099 / l.dollars, 2)
  end as value_ratio,
  jsonb_array_length(l.items) > 0 or l.rubies > 0 as contents_listed
from latest l
join priced p using (server_id, pack_id)
left join public.game_strings gs on gs.string_key = l.name_key;

comment on view public.shop_pack_value is
  'Every pack as last seen per server, valued: rubies included plus items at '
  'game_item_values, in dollars at 100 rubies per $0.99, and value_ratio = '
  'value / price. unvalued_items counts contents with no value yet. Passes '
  'and other packs whose contents the pack list does not carry have no value '
  'and contents_listed false (0215, 0216).';

-- The Ruby-shop view, 0215's but for the corrected name.
create or replace view public.shop_listing_value
with (security_invoker = true)
as
with latest as (
  select distinct on (s.server_id, s.shop_type, s.listing_id) s.*
    from public.shop_listing_snapshots s
   where s.currency_kind = 1 and s.currency_id = '15'
   order by s.server_id, s.shop_type, s.listing_id, s.captured_at desc
)
select
  l.server_id,
  l.shop_type,
  l.listing_id,
  l.item_id,
  coalesce(nm.name, gi.name) as name,
  gi.name_ko,
  l.qty,
  l.price,
  l.discount,
  l.captured_at,
  v.rubies as unit_rubies,
  v.source as value_source,
  case when v.rubies is not null and l.price > 0
       then round(l.qty * v.rubies / l.price, 2)
  end as value_ratio
from latest l
left join public.game_item_values v on v.item_id = l.item_id
left join public.game_items gi on gi.item_id = l.item_id
left join public.game_item_names nm on nm.item_id = l.item_id;
