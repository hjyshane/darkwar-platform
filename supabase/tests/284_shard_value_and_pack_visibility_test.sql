-- 0284: hero fragments with no value take the universal fragment's; an
-- officer's own value wins; the view carries the game's visibility fields.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ef901', 'shard-value-test');

insert into public.game_items (item_id, name, item_type) values
  ('210454', 'Orange Universal Hero Fragment', 62),
  ('990901', 'Hero A Fragments', 93),
  ('990902', 'Hero B Fragments', 93),
  ('990903', 'Hero C Exclusive Fragments', 215),
  ('990904', 'Some Scroll', 5);
set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('210454', 1000, 'estimated'),
  ('990902', 400, 'officer');
insert into public.game_pack_picks (match_kind, match_value, slots, item_id, qty) values
  ('pack_id', '990951', 1, '990901', 10),
  ('pack_id', '990951', 1, '990902', 10),
  ('pack_id', '990951', 1, '990903', 10),
  ('pack_id', '990952', 1, '990904', 10);
reset role;

insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, dollars, rubies, items, raw)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'sv:a', now(),
   '00000000-0000-4000-8000-0000000ef901', 580, 580, '990951', 0.99, 0, '[]',
   '{"is_show": "1", "show_type": ""}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'sv:b', now(),
   '00000000-0000-4000-8000-0000000ef901', 580, 580, '990952', 0.99, 0, '[]',
   '{"is_show": "1", "show_type": "6;240027"}');

-- 1. Fragments of heroes fold into one option worth the universal fragment:
--    10 x 1000 for the two unvalued ones; the officer's 400 stays apart.
select is((select jsonb_array_length(choices -> 0) from public.shop_pack_value where pack_id = '990951'),
  2, 'unvalued fragments fold; the officer-valued one stands apart');
select is((select choice_rubies from public.shop_pack_value where pack_id = '990951'), 10000::numeric,
  'the best option is 10 universal fragments');
-- 3. The fragments are marked as an estimate, not as unvalued.
select is((select choices -> 0 -> 0 -> 'items' -> 0 ->> 'source'
             from public.shop_pack_value where pack_id = '990951'), 'estimated',
  'a fallback value is an estimate');
select is((select (choices -> 0 -> 0 ->> 'unvalued')::int
             from public.shop_pack_value where pack_id = '990951'), 0,
  'and not counted as missing');
-- 5. The officer's value is not overridden.
select is((select (choices -> 0 -> 1 -> 'items' -> 0 ->> 'rubies')::numeric
             from public.shop_pack_value where pack_id = '990951'), 400::numeric,
  'a value an officer typed wins');
-- 6. Only fragments take it: a scroll with no value stays unvalued.
select is((select choice_rubies from public.shop_pack_value where pack_id = '990952'), 0::numeric,
  'an item that is not a fragment gets no borrowed value');
-- 7. The visibility fields come through.
select is((select show_type from public.shop_pack_value where pack_id = '990952'), '6;240027',
  'the game''s show_type is carried');

select * from finish();
rollback;
