-- 0215: packs valued from item values; officers own what they type.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ee001', 'shop-value-test');

-- A $4.99 pack: 500 rubies, 10 of item 1 (100 rubies each), 5 of item 2
-- (no value yet). Seen twice; the newer read is the one valued.
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, dollars, rubies,
   claimed_percent, items)
values
  (gen_random_uuid(), 'exchange.info', '1.0.0', 'sv:old', now() - interval '2 days',
   '00000000-0000-4000-8000-0000000ee001', 580, 580, 'p1', '900001', 4.99, 100, 500,
   '[{"id": "990001", "qty": 1}]'),
  (gen_random_uuid(), 'exchange.info', '1.0.0', 'sv:new', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000ee001', 580, 580, 'p1', '900001', 4.99, 500, 1200,
   '[{"id": "990001", "qty": 10}, {"id": "990002", "qty": 5}]');
insert into public.game_strings (string_key, en, ko) values ('900001', 'Test Pack', '테스트 팩');

-- The collector's key writes a game value; it stays 'game'.
set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values ('990001', 100, 'game');
reset role;

-- 1-5. The newest read, valued: 500 + 10 x 100 = 1,500 rubies = $14.85.
select is((select rubies from public.shop_pack_value where pack_id = 'p1'), 500,
  'the newest read of a pack is the one shown');
select is((select item_rubies from public.shop_pack_value where pack_id = 'p1'), 1000::numeric,
  'items are valued at their rubies per unit');
select is((select value_dollars from public.shop_pack_value where pack_id = 'p1'), 14.85,
  'value is rubies at $0.0099');
select is((select value_ratio from public.shop_pack_value where pack_id = 'p1'), 2.98,
  'ratio is value over price');
select is((select unvalued_items from public.shop_pack_value where pack_id = 'p1'), 1::bigint,
  'an item with no value is counted, not guessed');
-- 6. Names come from the strings the tool wrote.
select is((select name from public.shop_pack_value where pack_id = 'p1'), 'Test Pack',
  'the pack is named from its key');

-- 7-8. An officer's value becomes theirs; a member cannot write one.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ee101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sv-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000ee102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sv-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ee101', 'officer', 'sv officer'),
  ('00000000-0000-4000-8000-0000000ee102', 'member', 'sv member')
on conflict (user_id) do update set role = excluded.role;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ee101')::text, true);
set local role authenticated;
update public.game_item_values set rubies = 150, source = 'estimated' where item_id = '990001';
reset role;
select is((select source from public.game_item_values where item_id = '990001'), 'officer',
  'an officer''s edit is marked officer whatever source they send');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ee102')::text, true);
set local role authenticated;
select throws_ok(
  $$ insert into public.game_item_values (item_id, rubies, source) values ('990002', 1, 'officer') $$,
  '42501', null, 'a member cannot set a value');
-- 9. But reads the report.
select is((select count(*)::int from public.shop_pack_value where pack_id = 'p1'), 1,
  'a member reads the pack report');
select throws_ok(
  $$ delete from public.shop_pack_snapshots $$,
  '42501', null, 'and cannot touch the snapshots');
reset role;

-- 11. Anon reads nothing.
select ok(not has_table_privilege('anon', 'public.shop_pack_value', 'select')
          and not has_table_privilege('anon', 'public.game_item_values', 'select'),
  'anon has no read on the report or the values');

select * from finish();
rollback;
