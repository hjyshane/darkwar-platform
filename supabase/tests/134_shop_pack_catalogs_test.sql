-- 0235: the newest catalog per server is what is on sale; members read it,
-- a viewer and anon do not.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000e1001', 'catalog-test');
insert into public.shop_pack_catalogs
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_ids)
values
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'cat:1', '2026-10-05 10:00+00',
   '00000000-0000-4000-8000-0000000e1001', 580, 580, '["1", "2", "3"]'),
  (gen_random_uuid(), 'exchange.info', '1.1.0', 'cat:2', '2026-10-05 16:00+00',
   '00000000-0000-4000-8000-0000000e1001', 580, 580, '["2", "3"]');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000e1101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e1-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000e1102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'e1-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000e1101', 'member', 'member'),
  ('00000000-0000-4000-8000-0000000e1102', 'viewer', 'viewer')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e1101')::text, true);
select is((select pack_ids from public.shop_pack_catalog_latest where server_id = 580),
  '["2", "3"]'::jsonb, 'the newest capture is the catalog');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000e1102')::text, true);
select is((select count(*)::int from public.shop_pack_catalogs), 0, 'a viewer reads no catalog');
reset role;

select ok(not has_table_privilege('anon', 'public.shop_pack_catalogs', 'select'), 'anon reads none');
select ok(not has_table_privilege('authenticated', 'public.shop_pack_catalogs', 'truncate'),
  'authenticated cannot truncate');

select * from finish();
rollback;
