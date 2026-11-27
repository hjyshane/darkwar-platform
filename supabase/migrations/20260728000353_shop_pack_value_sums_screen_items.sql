-- 0353: shop_pack_value sums a pack's own contents with its screen's.
--
-- WHY. 0337 gave a pack EITHER its own `items` (exchange.info) OR, when that
-- list was empty, the ones its selling screen pays (shop_pack_offers). The
-- two are not alternatives: the catalog lists what the buyer gets at once,
-- the screen what follows. Checked against the store on 2026-11-26:
--   - Event Monthly Pass 240000007: the catalog's four instant items were
--     priced, the ten point-goal rewards the screen lists (scoreRewardArr)
--     were dropped because the catalog list was not empty.
--   - Precision Parts Weekly Pass 83013: the catalog says "10 parts" (the
--     instant grant); the week pays 8 parts, 3 one-hour speedups and 50
--     boxes a day for 7 days. Parser 1.1.0 (same change) now writes that
--     daily claim x days as the offer's items, track 'daily'.
-- So every weekly pass and the monthly pass were valued on a fraction of
-- what they pay.
--
-- WHAT. shop_pack_value is 0348's with one CTE changed: `items` becomes the
-- pack's list plus the screen's, summed per item id. A pack with an empty
-- list still takes the screen's (passes), a pack whose screen names it bare
-- keeps its own (unchanged), and a pack with both gets both. offer_track is
-- set whenever the screen's list is in play. Columns are unchanged, so
-- nothing that selects from the view needs re-creating.
--
-- Rows already in shop_pack_offers from parser 1.0.0 name weekly cards with
-- no items; the next day's login (1.1.0) writes them with items, and the
-- view prefers the row with items among a pack's last three days.

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
-- What a pack pays: its own list PLUS what its selling screen lists, summed
-- per item (0353). The two are different parts of one purchase - the pack's
-- list is the grant on buying (a weekly pass's "buy to instantly get", a
-- monthly pass's instant items), the screen's is what follows (the pass's
-- paid track over its levels, a weekly card's daily claim over its days, a
-- monthly pass's point-goal rewards). 0337 took one or the other, so a pack
-- with both was priced on its instant grant alone. Pack items come first,
-- then the screen's, so a reader sees the grant before the follow-on.
screen_items as (
  select o.server_id, o.pack_id, e.elem, e.ord
    from offer o
    cross join lateral jsonb_array_elements(o.items) with ordinality as e(elem, ord)
),
pack_items as (
  select server_id, pack_id,
         jsonb_agg(jsonb_build_object('id', id, 'qty', qty) order by first_seen) as items
    from (
      select server_id, pack_id, id, sum(qty) as qty, min(ord) as first_seen
        from (
          select p.server_id, p.pack_id, e.elem ->> 'id' as id,
                 (e.elem ->> 'qty')::numeric as qty, e.ord
            from newest_pack p
            cross join lateral jsonb_array_elements(p.items) with ordinality as e(elem, ord)
          union all
          select s.server_id, s.pack_id, s.elem ->> 'id',
                 (s.elem ->> 'qty')::numeric, 1000000 + s.ord
            from screen_items s
        ) parts
       where id is not null and qty is not null
       group by server_id, pack_id, id
    ) summed
   group by server_id, pack_id
),
latest as (
  select
    p.server_id, p.pack_id, p.name_key, p.pack_type, p.dollars, p.rubies,
    p.claimed_percent, p.starts_at, p.ends_at, p.captured_at, p.raw,
    coalesce(pi.items, '[]'::jsonb) as items,
    case when d.server_id is null then null else o.pack_id is not null end as offered,
    case when jsonb_array_length(o.items) > 0 then o.track end as offer_track,
    o.source_command as offer_source
  from newest_pack p
  left join offer_day d on d.server_id = p.server_id
  left join offer o on o.server_id = p.server_id and o.pack_id = p.pack_id
  left join pack_items pi on pi.server_id = p.server_id and pi.pack_id = p.pack_id
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
  -- 1 ruby = public.ruby_dollar_rate(), $0.0099 unless an admin set it
  -- (0348). Null, not zero, for a pack whose
  -- contents the pack list does not carry (0216).
  case when jsonb_array_length(l.items) > 0 or l.rubies > 0 or c.pack_id is not null
       then round((l.rubies + p.item_rubies + coalesce(c.choice_rubies, 0)
                   + coalesce(k.picked_rubies, 0)) * public.ruby_dollar_rate(), 2)
  end as value_dollars,
  case when l.dollars > 0
        and (jsonb_array_length(l.items) > 0 or l.rubies > 0 or c.pack_id is not null)
       then round((l.rubies + p.item_rubies + coalesce(c.choice_rubies, 0)
                   + coalesce(k.picked_rubies, 0)) * public.ruby_dollar_rate() / l.dollars, 2)
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
  -- Set when a screen's list is part of `contents`: the track of the pass it
  -- is ('special', 'middle', 'paid'), or 'daily' for a weekly card's claims.
  l.offer_track,
  l.offer_source
from latest l
join priced p using (server_id, pack_id)
left join choices c using (server_id, pack_id)
left join picked k using (server_id, pack_id)
left join public.game_strings gs on gs.string_key = l.name_key;

comment on view public.shop_pack_value is
  'Every pack as last seen per server, valued: rubies included plus items at '
  'game_item_values, in dollars at public.ruby_dollar_rate() per ruby '
  '($0.0099 unless an admin set site.ruby_dollar_rate, 0348), and value_ratio = '
  'value / price. unvalued_items counts fixed contents with no value yet. '
  'choices = the picks (slot > option > {rubies, unvalued, items}) from the '
  'pack''s chooseRewardList and from game_pack_picks; value counts the best '
  'option of each pick (choice_rubies). is_show / show_type are the game''s '
  'visibility fields (0284). contents is the pack''s own list plus what its '
  'selling screen lists, summed per item (shop_pack_offers, 0353; offer_track '
  'says which track of a pass, or daily for a weekly card''s claims), and '
  'offered says whether a screen on this server names the pack at all (0337). '
  'A pack with nothing in either has no value and contents_listed false '
  '(0215, 0216, 0276, 0278, 0284, 0337, 0348, 0353).';
