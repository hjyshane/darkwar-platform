-- 0354: a weekly card's client-table picks count once per day of the card;
-- a pack whose picks are not daily counts them once, as before.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000f3541', 'pick-days-test');

-- Server 580, two packs sharing a name key with a two-slot pick:
--   995401  a custom weekly card: its screen says 'daily' over 7 days, no items
--   995402  the same name, no screen names it (another server's copy)
-- and one pack with a pick keyed by id and a pass screen (not daily):
--   995403  a daily package: pick of one shard, named by a 'special' track
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, pack_type,
   dollars, rubies, items)
values
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'pd:p1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3541', 580, 580, '995401', '9954001', '27', 4.99, 500,
   '[{"id": "995490", "qty": 5}]'),
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'pd:p2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3541', 580, 580, '995402', '9954001', '27', 4.99, 500,
   '[{"id": "995490", "qty": 5}]'),
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'pd:p3', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3541', 580, 580, '995403', null, '26', 0.99, 100, '[]');

set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('995490', 10, 'game'),
  ('995491', 30, 'game'),   -- the best option of the pick
  ('995492', 20, 'game'),
  ('995493', 1, 'game');
insert into public.game_pack_picks (match_kind, match_value, slots, item_id, qty) values
  ('name_key', '9954001', 2, '995491', 1),
  ('name_key', '9954001', 2, '995492', 1),
  ('name_key', '9954001', 2, '995493', 1),
  ('pack_id', '995403', 1, '995491', 2);
reset role;

insert into public.shop_pack_offers
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, activity_id, track, items, levels)
values
  (gen_random_uuid(), 'get.week.card.info', '1.3.0', 'pd:o1', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3541', 580, 580, '995401', null, 'daily', '[]', 7),
  (gen_random_uuid(), 'get.battlepass.info', '1.3.0', 'pd:o3', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3541', 580, 580, '995403', '900003', 'special',
   '[{"id": "995490", "qty": 1}]', 3);

-- 1-3. The daily card: two picks a day (30 + 20) for 7 days.
select is((select pick_days from public.shop_pack_value where server_id = 580 and pack_id = '995401'),
  7, 'a daily card says its days');
select is((select choice_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995401'),
  (50 * 7)::numeric, 'its picks count once per day');
select is((select value_dollars from public.shop_pack_value where server_id = 580 and pack_id = '995401'),
  round((500 + 5 * 10 + 50 * 7) * public.ruby_dollar_rate(), 2), 'and the value follows');

-- 4-5. The same pick on a pack no screen names: once, no days.
select is((select pick_days from public.shop_pack_value where server_id = 580 and pack_id = '995402'),
  null, 'no screen, no days');
select is((select choice_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995402'),
  50::numeric, 'and the picks count once');

-- 6-7. A pick on a pack named by a pass track (not daily): once, no days.
select is((select pick_days from public.shop_pack_value where server_id = 580 and pack_id = '995403'),
  null, 'a special track is not a daily card');
select is((select choice_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995403'),
  60::numeric, 'its pick counts once (2 x 30)');

-- 8. One day's picks are what `choices` shows: two slots, not fourteen.
select is((select jsonb_array_length(choices) from public.shop_pack_value
            where server_id = 580 and pack_id = '995401'),
  2, 'choices lists one day');

select * from finish();
rollback;
