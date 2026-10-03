-- 0216: a pack with no listed contents has no value, not a value of zero.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ef001', 'passes-test');
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, dollars, rubies, items)
values
  (gen_random_uuid(), 'exchange.info', '1.0.0', 'ps:pass', now(),
   '00000000-0000-4000-8000-0000000ef001', 580, 580, 'pass1', 19.99, 0, '[]'),
  (gen_random_uuid(), 'exchange.info', '1.0.0', 'ps:ruby', now(),
   '00000000-0000-4000-8000-0000000ef001', 580, 580, 'ruby1', 0.99, 100, '[]');

select ok((select value_ratio is null and value_dollars is null
             from public.shop_pack_value where pack_id = 'pass1'),
  'a pass with no listed contents has no value and no ratio');
select is((select contents_listed from public.shop_pack_value where pack_id = 'pass1'), false,
  'and says why');
select is((select value_ratio from public.shop_pack_value where pack_id = 'ruby1'), 1.00,
  'a pack of rubies alone is still valued');

-- 4-6. An officer's name for an item is shown in place of the game's; a
-- member cannot set one.
insert into public.game_items (item_id, name) values ('990101', 'Game Name');
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, dollars, rubies, items)
values (gen_random_uuid(), 'exchange.info', '1.0.0', 'ps:named', now(),
   '00000000-0000-4000-8000-0000000ef001', 580, 580, 'named1', 4.99, 0,
   '[{"id": "990101", "qty": 1}]');
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ef101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pn-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000ef102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pn-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ef101', 'officer', 'pn officer'),
  ('00000000-0000-4000-8000-0000000ef102', 'member', 'pn member')
on conflict (user_id) do update set role = excluded.role;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ef101')::text, true);
set local role authenticated;
insert into public.game_item_names (item_id, name) values ('990101', 'Our Name');
select is((select contents -> 0 ->> 'name' from public.shop_pack_value where pack_id = 'named1'),
  'Our Name', 'the corrected name is shown in the pack');
reset role;
select is((select name from public.game_items where item_id = '990101'), 'Game Name',
  'and the game''s own name is untouched');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ef102')::text, true);
set local role authenticated;
select throws_ok(
  $$ insert into public.game_item_names (item_id, name) values ('990102', 'x') $$,
  '42501', null, 'a member cannot rename an item');
reset role;

select * from finish();
rollback;
