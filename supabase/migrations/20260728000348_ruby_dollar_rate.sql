-- 0348: ruby_dollar_rate - what a ruby is worth is a setting, not a number
-- written into the shop view.
--
-- WHY. Every $ figure on Shop value rests on one exchange rate: 100 rubies for
-- $0.99, so $0.0099 a ruby. It was written three times - twice in
-- shop_pack_value (value_dollars, value_ratio) and once in the dashboard's
-- dollarsOf() - so a change of store prices meant a migration and a release,
-- and changing only one side would have made the $ column and the ratio beside
-- it disagree. The settings registry (2026-11-24) is where an admin changes
-- such a value; this makes the view read the same one.
--
-- WHAT. ruby_dollar_rate() reads app_settings 'site.ruby_dollar_rate' and
-- falls back to 0.0099 for a missing, non-numeric or out-of-range value
-- (0.0001-1, the bounds the Settings form enforces). shop_pack_value is
-- 0337's, unchanged except for the two multiplications and its comment; the
-- columns are the same, so nothing that selects from it needs re-creating.
--
-- The function is SQL and stable, so the planner inlines it as one
-- uncorrelated subquery: the setting is read once per query, not per pack.
-- app_settings is readable by anon and authenticated (0032) and the view is
-- security_invoker, so whoever could read the view can read the rate.

create function public.ruby_dollar_rate()
returns numeric
language sql
stable
-- No `set search_path`: a SET clause stops the planner inlining the function,
-- and every name below is schema-qualified anyway. Invoker rights: it reads
-- only what the caller may read.
as $$
  select coalesce(
    (select (s.value #>> '{}')::numeric
       from public.app_settings s
      where s.key = 'site.ruby_dollar_rate'
        and jsonb_typeof(s.value) = 'number'
        and (s.value #>> '{}')::numeric between 0.0001 and 1),
    0.0099)
$$;

comment on function public.ruby_dollar_rate() is
  'Dollars per ruby for Shop value: app_settings site.ruby_dollar_rate, or '
  '0.0099 (100 rubies per $0.99) when unset or unreadable (0348).';

revoke all on function public.ruby_dollar_rate() from public;
grant execute on function public.ruby_dollar_rate() to anon, authenticated, service_role;

-- The rest of the view is 0337's.

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
  'game_item_values, in dollars at public.ruby_dollar_rate() per ruby '
  '($0.0099 unless an admin set site.ruby_dollar_rate, 0348), and value_ratio = '
  'value / price. unvalued_items counts fixed contents with no value yet. '
  'choices = the picks (slot > option > {rubies, unvalued, items}) from the '
  'pack''s chooseRewardList and from game_pack_picks; value counts the best '
  'option of each pick (choice_rubies). is_show / show_type are the game''s '
  'visibility fields (0284). A pack with no contents of its own takes the '
  'ones its selling screen lists (shop_pack_offers; offer_track says which '
  'track of a pass), and offered says whether a screen on this server names '
  'the pack at all (0337). A pack no screen fills has no value and '
  'contents_listed false (0215, 0216, 0276, 0278, 0284, 0337, 0348).';
