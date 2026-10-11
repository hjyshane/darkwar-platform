-- 0276: the rewards a pack lets you pick are listed and valued (best option).
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ef601', 'pack-choices-test');

insert into public.game_items (item_id, name) values ('990601', 'Gems'), ('990602', 'Speedup');
set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('990601', 1, 'game'), ('990602', 10, 'estimated');
reset role;

-- A $0.99 pick-one pack (one slot, 100 rubies included): option A is 50 of
-- item 990601 (50 rubies), option B is 8 of 990602 (80) plus an unvalued
-- item, option C is a hero-equipment reward (type 40) with no item value.
-- A second pack picks twice from the same two options. A third has a
-- malformed list, a fourth has none.
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, dollars, rubies, items, raw)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pc:one', now(),
   '00000000-0000-4000-8000-0000000ef601', 580, 580, 'one', 0.99, 100, '[]',
   '{"chooseRewardList": [[
      [{"type": 7, "value": {"id": "990601", "num": 50}}],
      [{"type": 7, "value": {"id": "990602", "num": 8}},
       {"type": 7, "value": {"id": "990699", "num": 1}}],
      [{"type": 40, "value": {"id": "990601", "num": 1}}]
   ]]}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pc:two', now(),
   '00000000-0000-4000-8000-0000000ef601', 580, 580, 'two', 4.99, 0,
   '[{"id": "990601", "qty": 100}]',
   '{"chooseRewardList": [
      [[{"type": 7, "value": {"id": "990601", "num": 10}}],
       [{"type": 7, "value": {"id": "990602", "num": 2}}]],
      [[{"type": 7, "value": {"id": "990601", "num": 10}}],
       [{"type": 7, "value": {"id": "990602", "num": 2}}]]
   ]}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pc:bad', now(),
   '00000000-0000-4000-8000-0000000ef601', 580, 580, 'bad', 4.99, 0, '[]',
   '{"chooseRewardList": [5, [7, [{"value": {"id": null, "num": 1}}],
      [{"type": 7, "value": {"id": "990601", "num": "x"}}]]]}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pc:none', now(),
   '00000000-0000-4000-8000-0000000ef601', 580, 580, 'none', 4.99, 0,
   '[{"id": "990601", "qty": 100}]', '{}');

-- 1-3. Slots, options and rewards come through, in the game's order.
select is((select jsonb_array_length(choices) from public.shop_pack_value where pack_id = 'one'),
  1, 'one slot is one pick');
select is((select jsonb_array_length(choices -> 0) from public.shop_pack_value where pack_id = 'one'),
  3, 'the slot lists all three options');
select is((select choices -> 0 -> 1 -> 'items' -> 0 ->> 'name'
             from public.shop_pack_value where pack_id = 'one'),
  'Speedup', 'a reward carries its name');

-- 4-5. The best option of the slot is what the pack is worth: 100 + 80.
select is((select choice_rubies from public.shop_pack_value where pack_id = 'one'), 80::numeric,
  'the best option of the slot is counted');
select is((select value_dollars from public.shop_pack_value where pack_id = 'one'), 1.78,
  'value is rubies included plus the best pick, at $0.0099');

-- 6. A type-40 reward is not looked up as an item: its id is another table's.
select is((select choices -> 0 -> 2 -> 'items' -> 0 ->> 'rubies'
             from public.shop_pack_value where pack_id = 'one'), null::text,
  'a type-40 reward does not borrow an item value');

-- 7-8. Two slots are two picks: 100 fixed + 2 x best (20) = 140 rubies.
select is((select jsonb_array_length(choices) from public.shop_pack_value where pack_id = 'two'),
  2, 'two slots are two picks');
select is((select value_dollars from public.shop_pack_value where pack_id = 'two'), 1.39,
  'each slot adds its best option to the fixed contents');

-- 9. An unvalued item in an option is counted on that option, not hidden.
select is((select (choices -> 0 -> 1 ->> 'unvalued')::int
             from public.shop_pack_value where pack_id = 'one'), 1,
  'an option says how many of its rewards have no value');

-- 10. A malformed list is no choices and no error.
select is((select choices from public.shop_pack_value where pack_id = 'bad'), '[]'::jsonb,
  'a malformed list yields no choices');

-- 11. A pack with no list is exactly what 0216 showed.
select is((select value_dollars from public.shop_pack_value where pack_id = 'none'), 0.99,
  'a pack with no choices is valued as before');

select * from finish();
rollback;
