-- 0354: a weekly card's picks count once a day, not once.
--
-- WHY. The Custom Weekly Pass lets its buyer pick two (Value) or four (Elite)
-- rewards from a list EVERY DAY for seven days. 0278 builds that pick from
-- the client's custom_weekly_card table (game_pack_picks, match_kind
-- name_key, slots = picks a day), and the view counted it once: the pass was
-- valued at one day's picks on top of its instant grant - a seventh of what
-- it pays. The card's own answer (get.week.card.info) carries no reward
-- list for it, only `time` = 7, so nothing in shop_pack_offers said how many
-- days there were; parser 1.3.0 now writes such a card as track 'daily'
-- with levels = days and no items.
--
-- WHAT. shop_pack_value is 0353's with: `offer` carrying `levels`; `latest`
-- deriving offer_days from a daily offer; `picked` multiplying the
-- client-table picks' value by those days; and one column appended,
-- pick_days, so the page can say "x 7 days" beside one day's picks. The
-- chooseRewardList picks (a pack's own, counted in `choices`) are not
-- multiplied: those are picks made once, at purchase. Columns before
-- pick_days are unchanged, so nothing that selects from the view needs
-- re-creating; the hand-kept types file gains the column.

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
         o.server_id, o.pack_id, o.items, o.track, o.levels, o.source_command
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
    o.source_command as offer_source,
    -- A weekly card's days (0354): its picks are made once a day. The
    -- parser writes track 'daily' with levels = days for a card whose
    -- daily reward is a pick (1.3.0); a card that lists its reward has
    -- that reward x days as items already, and no picks.
    case when o.track = 'daily' and o.levels > 0 then o.levels end as offer_days
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
-- The client-table picks (0278) counted once per day of the card (0354):
-- a weekly pass whose buyer picks two rewards a day pays fourteen picks.
picked as (
  select
    k.server_id, k.pack_id,
    k.picked_rubies * coalesce(l.offer_days, 1) as picked_rubies,
    l.offer_days as pick_days
  from cfg_packs k
  join latest l using (server_id, pack_id)
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
  l.offer_source,
  -- How many days the pack's picks are made over, when its selling screen
  -- says it is a daily card (0354); null otherwise. choice_rubies already
  -- counts every day; `choices` shows one day's picks.
  k.pick_days
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
  'A pack with nothing in either has no value and contents_listed false. '
  'Picks from game_pack_picks count once per day of a daily card (pick_days, '
  '0354) (0215, 0216, 0276, 0278, 0284, 0337, 0348, 0353, 0354).';
