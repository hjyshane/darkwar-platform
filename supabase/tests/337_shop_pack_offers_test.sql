-- 0337: a selling screen names the packs this server is sold and fills the
-- ones whose pack lists nothing; members read it, a viewer and anon do not.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000f3701', 'pack-offers-test');

-- Server 580: four packs.
--   993701  a pass, no contents of its own; its screen lists them today
--   993702  a pass, no contents; no screen names it (another server's)
--   993703  a weekly card with its own contents; a screen names it, bare
--   993704  a pass a screen named a week ago and not since (it ended)
-- Server 579: one empty pass and no screen ever read.
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, pack_type,
   dollars, rubies, items)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'po:p1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993701', null, '25', 9.99, 0, '[]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'po:p2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993702', null, '25', 9.99, 0, '[]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'po:p3', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993703', null, '27', 4.99, 0,
   '[{"id": "993790", "qty": 2}]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'po:p4', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993704', null, '25', 4.99, 0, '[]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'po:p5', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3701', 580, 579, '993701', null, '25', 9.99, 0, '[]');

set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values ('993790', 100, 'game');
reset role;

insert into public.shop_pack_offers
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, activity_id, track, items, levels)
values
  -- today: the pass with its paid track, and the same pack named bare by
  -- another screen a moment later (the one with rewards must win)
  (gen_random_uuid(), 'get.battlepass.info', '1.0.0', 'po:o1', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993701', '400047', 'special',
   '[{"id": "993790", "qty": 30}, {"id": "993791", "qty": 5}]', 30),
  (gen_random_uuid(), 'multi.choice.gift.info', '1.0.0', 'po:o1b', now() - interval '1 hour',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993701', null, null, '[]', null),
  -- an older reading of the same pass with other rewards: superseded
  (gen_random_uuid(), 'get.battlepass.info', '1.0.0', 'po:o1old', now() - interval '2 days',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993701', '400047', 'special',
   '[{"id": "993790", "qty": 1}]', 30),
  (gen_random_uuid(), 'get.week.card.info', '1.0.0', 'po:o3', now() - interval '2 hours',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993703', null, null, '[]', null),
  (gen_random_uuid(), 'get.battlepass.info', '1.0.0', 'po:o4', now() - interval '7 days',
   '00000000-0000-4000-8000-0000000f3701', 580, 580, '993704', '400001', 'special',
   '[{"id": "993790", "qty": 9}]', 7);

-- 1-5. The named pass takes the screen's contents and a value.
select is((select count(*)::int from public.shop_pack_value
            where server_id = 580 and pack_id = '993701'), 1, 'one row for the pass');
select is((select offered from public.shop_pack_value where server_id = 580 and pack_id = '993701'),
  true, 'a pack a screen names is sold here');
select is((select contents_listed from public.shop_pack_value
            where server_id = 580 and pack_id = '993701'), true, 'and its contents are listed');
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '993701'),
  3000::numeric, 'the newest reading that lists rewards is the one priced: 30 x 100');
select is((select offer_track from public.shop_pack_value where server_id = 580 and pack_id = '993701'),
  'special', 'and it says which track of the pass that is');
select is((select unvalued_items::int from public.shop_pack_value
            where server_id = 580 and pack_id = '993701'), 1, 'a reward with no value is counted so');
select is((select value_dollars from public.shop_pack_value where server_id = 580 and pack_id = '993701'),
  29.70::numeric, '3000 rubies are $29.70');

-- 8-9. The pass nobody names: a row still, not sold here, no contents.
select is((select offered from public.shop_pack_value where server_id = 580 and pack_id = '993702'),
  false, 'a pack no screen names is not sold here');
select is((select contents_listed from public.shop_pack_value
            where server_id = 580 and pack_id = '993702'), false, 'and stays without contents');

-- 10-12. A pack with its own contents keeps them.
select is((select offered from public.shop_pack_value where server_id = 580 and pack_id = '993703'),
  true, 'the weekly card is sold here');
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '993703'),
  200::numeric, 'its own contents are the ones priced');
select is((select count(*)::int from public.shop_pack_value
            where server_id = 580 and pack_id = '993703' and offer_track is null), 1,
  'and no track is claimed for them');

-- 13. A pass last named a week before the newest reading has ended.
select is((select offered from public.shop_pack_value where server_id = 580 and pack_id = '993704'),
  false, 'a pack not named for more than three days is no longer sold here');

-- 14. A server whose screens were never read: unknown, not "not sold".
select is((select count(*)::int from public.shop_pack_value
            where server_id = 579 and pack_id = '993701' and offered is null), 1,
  'no screen read for a server leaves offered null');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000f3711', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f37-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000f3712', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f37-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000f3711', 'member', 'member'),
  ('00000000-0000-4000-8000-0000000f3712', 'viewer', 'viewer')
on conflict (user_id) do update set role = excluded.role;

-- 15-17. Members read the table; a viewer and anon do not.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000f3711')::text, true);
select is((select count(*)::int from public.shop_pack_offers
            where collector_id = '00000000-0000-4000-8000-0000000f3701'), 5, 'a member reads the offers');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000f3712')::text, true);
select is((select count(*)::int from public.shop_pack_offers), 0, 'a viewer reads none');
reset role;

select ok(not has_table_privilege('anon', 'public.shop_pack_offers', 'select'), 'anon reads none');

select * from finish();
rollback;
