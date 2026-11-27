-- 0355: an officer enters what a pack pays beyond the game's lists; a member
-- reads it and cannot write; the view sums it, by name key or by pack id.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000e3551', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e3551-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000e3552', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e3552-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e3551', 'officer', 'officer'),
  ('00000000-0000-4000-8000-0000000e3552', 'member', 'member')
on conflict (user_id) do update set role = excluded.role;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000f3551', 'pack-extras-test');

-- Server 580: two packs of one name (a monthly pass and its reissue), and
-- one pack of another name that must stay untouched.
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, pack_type,
   dollars, rubies, items)
values
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'px:p1', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3551', 580, 580, '995501', '9955001', '5', 9.99, 1000,
   '[{"id": "995590", "qty": 1}]'),
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'px:p2', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3551', 580, 580, '995502', '9955001', '5', 4.99, 500, '[]'),
  (gen_random_uuid(), 'exchange.info', '1.2.0', 'px:p3', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000f3551', 580, 580, '995503', '9955002', '5', 9.99, 1000, '[]');

set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('995590', 10, 'game'),
  ('995591', 2, 'game');
reset role;

set local role authenticated;

-- 1-2. An officer enters a daily claim: 10 of an item and 100 rubies, 30 times,
-- for every pack of the name; and a one-off item for one pack id.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e3551')::text, true);
select lives_ok(
  $$ insert into public.game_pack_extras (match_kind, match_value, item_id, qty, repeat, note)
     values ('name_key', '9955001', '995591', 10, 30, 'daily claim, read 2026-11-26'),
            ('name_key', '9955001', null, 100, 30, 'daily rubies') $$,
  'an officer enters extras');
select lives_ok(
  $$ insert into public.game_pack_extras (match_kind, match_value, item_id, qty)
     values ('pack_id', '995501', '995590', 2) $$,
  'and one for a single pack id');

-- 3. A second line for the same item of the same pack is a change, not a row.
select throws_ok(
  $$ insert into public.game_pack_extras (match_kind, match_value, item_id, qty)
     values ('name_key', '9955001', '995591', 5) $$,
  '23505', null, 'one line per item per pack');

-- 4-6. A member reads them and cannot add or change one.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e3552')::text, true);
select is((select count(*)::int from public.game_pack_extras where match_value = '9955001'),
  2, 'a member reads extras');
select throws_ok(
  $$ insert into public.game_pack_extras (match_kind, match_value, item_id, qty)
     values ('pack_id', '995503', '995590', 1) $$,
  '42501', null, 'a member cannot add an extra');
update public.game_pack_extras set qty = 999 where match_value = '9955001';
select is((select max(qty) from public.game_pack_extras where match_value = '9955001'),
  100::numeric, 'nor change one');
reset role;

-- 7. Anon has nothing.
select ok(not has_table_privilege('anon', 'public.game_pack_extras', 'select'),
  'anon has no read');

-- 8-10. The view: pack 995501 gets 1 + 2 of item 995590 (own list + id extra),
-- 300 of item 995591 (name extra) and 3,000 extra rubies.
select is((select item_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995501'),
  (3 * 10 + 300 * 2)::numeric, 'extra items are summed into the contents');
select is((select extra_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995501'),
  3000::numeric, 'extra rubies are reported');
select is((select value_dollars from public.shop_pack_value where server_id = 580 and pack_id = '995501'),
  round((1000 + 30 + 600 + 3000) * public.ruby_dollar_rate(), 2), 'and counted in the value');

-- 11. The reissue of the name gets the name extras and has contents now.
select is((select contents_listed from public.shop_pack_value where server_id = 580 and pack_id = '995502'),
  true, 'a name extra reaches every pack of the name');

-- 12. Another name is untouched.
select is((select extra_rubies from public.shop_pack_value where server_id = 580 and pack_id = '995503'),
  0::numeric, 'another pack is untouched');

select * from finish();
rollback;
