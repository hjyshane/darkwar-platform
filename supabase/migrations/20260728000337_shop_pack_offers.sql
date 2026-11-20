-- 0337: shop_pack_offers - which packs this server is actually sold, and what
-- the passes pay.
--
-- `exchange.info` is the game's whole pack table for the account, not its
-- store. On 2026-11-19 it carried 423 packs: 107 battle-pass packs with no
-- contents at all, five stages of each custom weekly pass, seven season
-- weekly cards. The Packs tab showed every one of them, and "contents not
-- listed" for 144.
--
-- The screens that sell those packs answer at login with the pack's id - and,
-- for a pass, the rewards level by level (get.battlepass.info,
-- get.season.battlepass.info, growth.plan.info, get.month.detect.card,
-- get.week.card.info, get.season.week.card.info, multi.choice.gift.info,
-- get.custom.package.activity.info, get.month.pay.act.info). Checked against
-- that day's catalog: 8 of the 107 passes are named, 8 of 16 weekly passes,
-- 1 of 7 season weekly cards, 1 of 2 radar cards - the rest are other
-- servers' and other stages' versions.
--
-- One row per pack a screen names, per day (the key carries the capture day:
-- the day a pack stops being written is the day it stopped being sold here).
--
--   track  : the track of a pass `items` is ('special', 'middle', 'paid');
--            null when the row only says "sold here" and the pack lists its
--            own contents
--   items  : that track's item rewards summed over every level - what the
--            pack pays a buyer who finishes it
--   levels : how many levels that sum covers
--
-- WHAT IS INFERRED: which pack unlocks which track of a two-pack pass
-- (cheaper = middle, by elimination) - nobody has bought one with capture on.
-- The parser's docstring (normalize/shop_offers.py) lists each case.
--
-- shop_pack_value then (a) gives a pack with no contents of its own the ones
-- its screen lists, and (b) says `offered`, so the dashboard can show only
-- what this server sells. It does NOT hide anything itself: every pack is
-- still a row, and a server whose screens were never read has offered = null.
--
-- NOT DONE: retention. Rows are small (a pass's paid track, ~2 KB) and about
-- 30 a day; retention_purge (0302) does not know the table yet.

create table public.shop_pack_offers (
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
  pack_id text not null check (pack_id ~ '^[0-9]+$'),
  activity_id text,
  track text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  levels int
);

comment on table public.shop_pack_offers is
  'A pack a selling screen of the game named for this server, once per day it '
  'was seen (0337): proof the pack is sold here, and for a pass the rewards '
  'of its paid track summed over the levels (items, track, levels).';

create index shop_pack_offers_server_captured_idx
  on public.shop_pack_offers (server_id, captured_at desc);

alter table public.shop_pack_offers enable row level security;
revoke all on public.shop_pack_offers from anon, authenticated;
grant select on public.shop_pack_offers to authenticated;
grant all on public.shop_pack_offers to service_role;

-- The readers of the other shop tables (0235, widened by 0283).
create policy member_read on public.shop_pack_offers
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'community', 'officer', 'admin'));

-- The rest of the view is 0284's.

create or replace view public.shop_pack_value
with (security_invoker = true)
as
with newest_pack as (
  select distinct on (p.server_id, p.pack_id) p.*
    from public.shop_pack_snapshots p
   order by p.server_id, p.pack_id, p.captured_at desc
),
-- The newest time any selling screen was read on each server (0337).
offer_day as (
  select o.server_id, max(o.captured_at) as newest
    from public.shop_pack_offers o
   group by o.server_id
),
-- A pack a selling screen named within three days of that: sold here now.
-- A row is written once a day while the screen exists, so a pack whose pass
-- has ended drops out. Of two screens naming one pack, the one that lists
-- rewards is taken.
offer as (
  select distinct on (o.server_id, o.pack_id)
         o.server_id, o.pack_id, o.items, o.track, o.source_command
    from public.shop_pack_offers o
    join offer_day d on d.server_id = o.server_id
   where o.captured_at >= d.newest - interval '3 days'
   order by o.server_id, o.pack_id, (jsonb_array_length(o.items) > 0) desc, o.captured_at desc
),
-- The pack as the rest of the view prices it. `items` is the pack's own
-- list, or - when it has none and a selling screen lists what it pays - the
-- screen's (a pass's paid track summed over its levels).
latest as (
  select
    p.server_id, p.pack_id, p.name_key, p.pack_type, p.dollars, p.rubies,
    p.claimed_percent, p.starts_at, p.ends_at, p.captured_at, p.raw,
    case when jsonb_array_length(p.items) = 0 and o.pack_id is not null
         then o.items else p.items end as items,
    case when d.server_id is null then null else o.pack_id is not null end as offered,
    case when jsonb_array_length(p.items) = 0 and jsonb_array_length(o.items) > 0
         then o.track end as offer_track,
    o.source_command as offer_source
  from newest_pack p
  left join offer_day d on d.server_id = p.server_id
  left join offer o on o.server_id = p.server_id and o.pack_id = p.pack_id
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
),
-- chooseRewardList (0276): one row per reward of every option of every slot.
-- Every level is guarded with jsonb_typeof: a malformed list yields no rows.
picks as (
  select
    l.server_id,
    l.pack_id,
    s.slot_no,
    o.opt_no,
    coalesce(sum(r.qty * v.rubies), 0) as rubies,
    count(*) filter (where v.item_id is null) as unvalued,
    jsonb_agg(
      jsonb_build_object(
        'type', r.type, 'id', r.id, 'qty', r.qty,
        'name', coalesce(nm.name, gi.name), 'name_ko', gi.name_ko,
        'rubies', v.rubies, 'source', v.source)
      order by r.rw_no
    ) as items
  from latest l
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(l.raw -> 'chooseRewardList') = 'array'
         then l.raw -> 'chooseRewardList' else '[]'::jsonb end
  ) with ordinality as s(slot, slot_no)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.slot) = 'array' then s.slot else '[]'::jsonb end
  ) with ordinality as o(opt, opt_no)
  cross join lateral (
    select
      rw.value ->> 'type' as type,
      rw.value -> 'value' ->> 'id' as id,
      (rw.value -> 'value' ->> 'num')::numeric as qty,
      rw.ord as rw_no
    from jsonb_array_elements(
      case when jsonb_typeof(o.opt) = 'array' then o.opt else '[]'::jsonb end
    ) with ordinality as rw(value, ord)
    where rw.value -> 'value' ->> 'id' is not null
      and rw.value -> 'value' ->> 'num' ~ '^[0-9]+(\.[0-9]+)?$'
  ) r
  -- Only type 7 is an item id; another type's id is another table's.
  left join public.game_item_values v on r.type = '7' and v.item_id = r.id
  left join public.game_items gi on r.type = '7' and gi.item_id = r.id
  left join public.game_item_names nm on r.type = '7' and nm.item_id = r.id
  group by l.server_id, l.pack_id, s.slot_no, o.opt_no
),
slots as (
  select
    server_id,
    pack_id,
    slot_no,
    max(rubies) as best_rubies,
    jsonb_agg(
      jsonb_build_object('rubies', rubies, 'unvalued', unvalued, 'items', items)
      order by opt_no
    ) as options
  from picks
  group by server_id, pack_id, slot_no
),
-- The client's picks (0278): options of equal value fold into one.
cfg as (
  select
    l.server_id,
    l.pack_id,
    c.slots,
    c.item_id,
    c.qty,
    c.qty * coalesce(v.rubies, h.rubies, 0) as rubies,
    v.item_id is null and h.rubies is null as unvalued,
    coalesce(nm.name, gi.name) as name,
    gi.name_ko,
    coalesce(v.rubies, h.rubies) as unit_rubies,
    coalesce(v.source, case when h.rubies is not null then 'estimated' end) as source
  from latest l
  join public.game_pack_picks c
    on (c.match_kind = 'pack_id' and c.match_value = l.pack_id)
    or (c.match_kind = 'name_key' and l.name_key is not null and c.match_value = l.name_key)
  left join public.game_item_values v on v.item_id = c.item_id
  left join public.game_items gi on gi.item_id = c.item_id
  left join public.game_item_names nm on nm.item_id = c.item_id
  -- A hero's fragments (93) and a hero's exclusive-equipment fragments (215)
  -- are worth the Orange Universal Hero Fragment when nobody has valued
  -- them: the pick is "which hero", and they are interchangeable.
  left join lateral (
    select u.rubies
      from public.game_item_values u
     where u.item_id = '210454' and gi.item_type in (93, 215) and v.item_id is null
  ) h on true
),
cfg_options as (
  select
    server_id,
    pack_id,
    max(slots) as slots,
    qty,
    rubies,
    unvalued,
    count(distinct item_id) as same,
    (array_agg(name order by name))[1:12] as names,
    (array_agg(
       jsonb_build_object(
         'type', '7', 'id', item_id, 'qty', qty, 'name', name, 'name_ko', name_ko,
         'rubies', unit_rubies, 'source', source)
       order by name nulls last, item_id))[1] as item
  from cfg
  group by server_id, pack_id, qty, rubies, unvalued
),
-- How many of each option the best `slots` picks take, each option at most
-- `same` times (distinct options, never the same one twice).
cfg_ranked as (
  select
    o.*,
    greatest(0, least(
      o.same,
      o.slots - coalesce(
        sum(o.same) over (
          partition by o.server_id, o.pack_id
          order by o.rubies desc, o.qty
          rows between unbounded preceding and 1 preceding), 0)
    )) as taken
  from cfg_options o
),
cfg_packs as (
  select
    server_id,
    pack_id,
    max(slots) as slots,
    sum(rubies * taken) as picked_rubies,
    jsonb_agg(
      jsonb_build_object(
        'rubies', rubies, 'unvalued', case when unvalued then 1 else 0 end,
        'items', jsonb_build_array(item), 'same', same,
        'names', to_jsonb(names), 'counted', taken > 0)
      order by rubies desc, qty
    ) as options
  from cfg_ranked
  group by server_id, pack_id
),
choices as (
  select
    a.server_id,
    a.pack_id,
    sum(a.best_rubies) as choice_rubies,
    jsonb_agg(a.options order by a.slot_no) as choices
  from (
    select server_id, pack_id, slot_no, best_rubies, options from slots
    union all
    -- one slot per pick, each the whole list; the value is carried below
    select p.server_id, p.pack_id, 1000 + g, 0, p.options
      from cfg_packs p
     cross join lateral generate_series(1, p.slots) g
  ) a
  group by a.server_id, a.pack_id
),
picked as (
  select server_id, pack_id, picked_rubies from cfg_packs
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
  case when jsonb_array_length(l.items) > 0 or l.rubies > 0 or c.pack_id is not null
       then round((l.rubies + p.item_rubies + coalesce(c.choice_rubies, 0)
                   + coalesce(k.picked_rubies, 0)) * 0.0099, 2)
  end as value_dollars,
  case when l.dollars > 0
        and (jsonb_array_length(l.items) > 0 or l.rubies > 0 or c.pack_id is not null)
       then round((l.rubies + p.item_rubies + coalesce(c.choice_rubies, 0)
                   + coalesce(k.picked_rubies, 0)) * 0.0099 / l.dollars, 2)
  end as value_ratio,
  jsonb_array_length(l.items) > 0 or l.rubies > 0 or c.pack_id is not null as contents_listed,
  coalesce(c.choices, '[]'::jsonb) as choices,
  coalesce(c.choice_rubies, 0) + coalesce(k.picked_rubies, 0) as choice_rubies,
  -- What the game checks before it shows the pack (0284): `is_show` and
  -- `show_type` ("6;<item>": only while the player holds that event item).
  l.raw ->> 'is_show' as is_show,
  l.raw ->> 'show_type' as show_type,
  -- Whether a selling screen names the pack (0337): true = sold on this
  -- server now; false = the server's screens were read and none names it;
  -- null = no screen has been read for the server, so nothing is known.
  l.offered,
  -- Set when `contents` came from a screen rather than the pack: the track
  -- of the pass they are ('special', 'middle', 'paid').
  l.offer_track,
  l.offer_source
from latest l
join priced p using (server_id, pack_id)
left join choices c using (server_id, pack_id)
left join picked k using (server_id, pack_id)
left join public.game_strings gs on gs.string_key = l.name_key;

comment on view public.shop_pack_value is
  'Every pack as last seen per server, valued: rubies included plus items at '
  'game_item_values, in dollars at 100 rubies per $0.99, and value_ratio = '
  'value / price. unvalued_items counts fixed contents with no value yet. '
  'choices = the picks (slot > option > {rubies, unvalued, items}) from the '
  'pack''s chooseRewardList and from game_pack_picks; value counts the best '
  'option of each pick (choice_rubies). is_show / show_type are the game''s '
  'visibility fields (0284). A pack with no contents of its own takes the '
  'ones its selling screen lists (shop_pack_offers; offer_track says which '
  'track of a pass), and offered says whether a screen on this server names '
  'the pack at all (0337). A pack no screen fills has no value and '
  'contents_listed false (0215, 0216, 0276, 0278, 0284, 0337).';
