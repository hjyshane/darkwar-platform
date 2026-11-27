-- 0353: a pack's contents are its own list plus its screen's, summed per
-- item; a pack with only one of the two is priced as before.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000f3531', 'pack-sums-test');

-- Server 580, three packs:
--   995301  a monthly pass: instant grant in the catalog, point goals on its screen
--   995302  a weekly card: instant grant in the catalog, daily claim x 7 on its screen
--   995303  a pass: nothing in the catalog, its paid track on its screen
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, pack_type,
   dollars, rubies, items)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'ps:p1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995301', null, '39', 9.99, 1000,
   '[{"id": "995390", "qty": 60}, {"id": "995391", "qty": 10}]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'ps:p2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995302', null, '27', 4.99, 0,
   '[{"id": "995390", "qty": 10}]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'ps:p3', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995303', null, '25', 19.99, 0, '[]');

set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('995390', 10, 'game'),   -- a part
  ('995391', 1, 'game'),    -- a coin
  ('995392', 20, 'game');   -- a speedup
reset role;

insert into public.shop_pack_offers
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, activity_id, track, items, levels)
values
  (gen_random_uuid(), 'get.month.detect.card', '1.1.0', 'ps:o1', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995301', '900001', 'paid',
   '[{"id": "995390", "qty": 60}, {"id": "995392", "qty": 15}]', 10),
  (gen_random_uuid(), 'get.week.card.info', '1.1.0', 'ps:o2', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995302', null, 'daily',
   '[{"id": "995390", "qty": 56}, {"id": "995392", "qty": 21}]', 7),
  (gen_random_uuid(), 'get.battlepass.info', '1.1.0', 'ps:o3', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3531', 580, 580, '995303', '900002', 'special',
   '[{"id": "995390", "qty": 30}]', 30);

-- 1-3. The monthly pass: 60 + 60 parts, 10 coins, 15 speedups.
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995301'),
  (120 * 10 + 10 * 1 + 15 * 20)::numeric, 'instant grant and point goals are both priced');
select is((select (select jsonb_agg(jsonb_build_object('id', c ->> 'id', 'qty', (c ->> 'qty')::numeric)
                                      order by c ->> 'id')
                     from jsonb_array_elements(v.contents) c)
             from public.shop_pack_value v where server_id = 580 and pack_id = '995301'),
  '[{"id": "995390", "qty": 120}, {"id": "995391", "qty": 10}, {"id": "995392", "qty": 15}]'::jsonb,
  'one entry per item, quantities summed');
select is((select offer_track from public.shop_pack_value where server_id = 580 and pack_id = '995301'),
  'paid', 'the screen''s track is named when its list is in play');

-- 4-6. The weekly card: 10 + 56 parts and 21 speedups, two entries.
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995302'),
  (66 * 10 + 21 * 20)::numeric, 'a weekly card is worth its grant plus seven daily claims');
select is((select offer_track from public.shop_pack_value where server_id = 580 and pack_id = '995302'),
  'daily', 'and says the screen''s part is the daily claim');
select is((select jsonb_array_length(contents) from public.shop_pack_value
            where server_id = 580 and pack_id = '995302'),
  2, 'the part appears once, not once per source');

-- 7-8. A pass with nothing of its own is priced on its track, as before.
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995303'),
  300::numeric, 'an empty pack takes its screen''s list');
select is((select contents_listed from public.shop_pack_value where server_id = 580 and pack_id = '995303'),
  true, 'and counts as having contents');

-- 9. Nothing is counted twice: the value in dollars follows the sum.
select is((select unvalued_items::int from public.shop_pack_value where server_id = 580 and pack_id = '995301'),
  0, 'every summed item carries its value');

select * from finish();
rollback;
