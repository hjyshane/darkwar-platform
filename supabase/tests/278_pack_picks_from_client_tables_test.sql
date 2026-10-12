-- 0278: the client's picks (daily hero shards, weekly-pass slots) are listed
-- and valued, options of equal value folded, best `slots` options counted.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ef701', 'pack-picks-test');

insert into public.game_items (item_id, name) values
  ('990701', 'Hero A Shard'), ('990702', 'Hero B Shard'), ('990703', 'Hero C Shard'),
  ('990711', 'Gem'), ('990712', 'Speedup'), ('990713', 'Scrap');
set local role service_role;
insert into public.game_item_values (item_id, rubies, source) values
  ('990701', 10, 'estimated'), ('990702', 10, 'estimated'), ('990703', 10, 'estimated'),
  ('990711', 5, 'game'), ('990712', 3, 'game');
insert into public.game_pack_picks (match_kind, match_value, slots, item_id, qty) values
  -- a daily package: 10 of one hero's shards, three heroes, equal value
  ('pack_id', '990801', 1, '990701', 10),
  ('pack_id', '990801', 1, '990702', 10),
  ('pack_id', '990801', 1, '990703', 10),
  -- a weekly pass: 2 picks from three options; the scrap has no value
  ('name_key', '990900', 2, '990711', 1),
  ('name_key', '990900', 2, '990712', 1),
  ('name_key', '990900', 2, '990713', 1);
reset role;

insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, dollars, rubies, items, raw)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pp:daily', now(),
   '00000000-0000-4000-8000-0000000ef701', 580, 580, '990801', '990001', 4.99, 100, '[]', '{}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pp:w1', now(),
   '00000000-0000-4000-8000-0000000ef701', 580, 580, '990811', '990900', 4.99, 0, '[]', '{}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pp:w2', now(),
   '00000000-0000-4000-8000-0000000ef701', 580, 580, '990812', '990900', 4.99, 0, '[]', '{}'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'pp:none', now(),
   '00000000-0000-4000-8000-0000000ef701', 580, 580, '990821', '990002', 4.99, 100, '[]', '{}');

-- 1-3. Three heroes of equal value fold into one option of the daily pack.
select is((select jsonb_array_length(choices) from public.shop_pack_value where pack_id = '990801'),
  1, 'a daily package is one pick');
select is((select jsonb_array_length(choices -> 0) from public.shop_pack_value where pack_id = '990801'),
  1, 'heroes of equal value are one option');
select is((select (choices -> 0 -> 0 ->> 'same')::int from public.shop_pack_value where pack_id = '990801'),
  3, 'and it says how many it folded');

-- 4-5. 100 rubies included + 10 shards x 10 = 200 rubies = $1.98.
select is((select choice_rubies from public.shop_pack_value where pack_id = '990801'), 100::numeric,
  'the pick adds the value of the shards');
select is((select value_dollars from public.shop_pack_value where pack_id = '990801'), 1.98,
  'the pack is worth its rubies and the picked shards');

-- 6-8. A weekly pass is keyed by name key: both ids carry it, two picks.
select is((select jsonb_array_length(choices) from public.shop_pack_value where pack_id = '990811'),
  2, 'two slots are two picks');
select is((select jsonb_array_length(choices -> 0) from public.shop_pack_value where pack_id = '990812'),
  3, 'every pack id with the name key lists the options');
select is((select choice_rubies from public.shop_pack_value where pack_id = '990811'), 8::numeric,
  'the best two distinct options are counted (5 + 3), never one twice');

-- 9. The best option comes first and is the one marked as counted.
select is((select choices -> 0 -> 0 -> 'items' -> 0 ->> 'name'
             from public.shop_pack_value where pack_id = '990811'), 'Gem',
  'options are listed best first');
select ok((select (choices -> 0 -> 2 ->> 'counted')::boolean is false
             from public.shop_pack_value where pack_id = '990811'),
  'an option no pick takes is not counted');

-- 10. An item with no value counts 0 and says so.
select is((select (choices -> 0 -> 2 ->> 'unvalued')::int
             from public.shop_pack_value where pack_id = '990811'), 1,
  'an option with no value is marked');

-- 11. A pack with no configured picks is unchanged.
select is((select value_dollars from public.shop_pack_value where pack_id = '990821'), 0.99,
  'a pack without picks is valued as before');

-- 12-13. The table is readable by members and not writable by them.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ef711', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pp-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ef711', 'member', 'pp member')
on conflict (user_id) do update set role = excluded.role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000ef711')::text, true);
set local role authenticated;
select is((select count(*) from public.game_pack_picks where match_value = '990801'), 3::bigint,
  'a member reads the picks');
select throws_ok(
  $$ insert into public.game_pack_picks (match_kind, match_value, slots, item_id, qty)
     values ('pack_id', '1', 1, '1', 1) $$,
  '42501', null, 'a member cannot write them');
reset role;

select * from finish();
rollback;
