-- 0302: the map keeps a day and the newest of each thing; the shop of other servers keeps
-- the newest reading of each; our two servers' shop and everybody's rankings are untouched.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf02', 'shrink test', 'offline', 'test')
on conflict do nothing;
insert into public.servers (server_id, server_group) values (573, 'test') on conflict do nothing;

-- The seed's shop and map rows are old enough to count; this test is about its own.
delete from public.world_city_snapshots where idempotency_key not like 'test:%';
delete from public.world_truck_snapshots where idempotency_key not like 'test:%';
delete from public.world_viewport_snapshots where idempotency_key not like 'test:%';
delete from public.shop_listing_snapshots where idempotency_key not like 'test:%';

create function pg_temp.city(p_key text, p_uid bigint, p_hours int) returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, point_id, x, y)
  values (gen_random_uuid(), 'world.get.new', 't', p_key, now() - make_interval(hours => p_hours),
          '00000000-0000-4000-8000-00000000cf02', 580, 573, p_uid, 1, 1, 1);
$$;
create function pg_temp.shop(p_key text, p_server int, p_listing int, p_days int) returns void language sql as $$
  insert into public.shop_listing_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, shop_type, listing_id, item_id, qty, price)
  values (gen_random_uuid(), 'shop.get', 't', p_key, now() - make_interval(days => p_days),
          '00000000-0000-4000-8000-00000000cf02', 580, p_server, 1, p_listing, 1, 1, 10);
$$;

-- A base seen 80, 50 and 3 hours ago, and another seen once 200 hours ago.
select pg_temp.city('test:shr:c1', 9380000000000573, 80);
select pg_temp.city('test:shr:c2', 9380000000000573, 50);
select pg_temp.city('test:shr:c3', 9380000000000573, 3);
select pg_temp.city('test:shr:c4', 9380000000001573, 200);
-- A truck seen 80 and 50 hours ago, and a swept area swept 400 and 30 hours ago.
insert into public.world_truck_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, truck_uuid)
values
  (gen_random_uuid(), 'trucks', 't', 'test:shr:t1', now() - interval '80 hours',
   '00000000-0000-4000-8000-00000000cf02', 580, 573, 'truck-a'),
  (gen_random_uuid(), 'trucks', 't', 'test:shr:t2', now() - interval '50 hours',
   '00000000-0000-4000-8000-00000000cf02', 580, 573, 'truck-a');
insert into public.world_viewport_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, center_x, center_y, view_lvl, object_count)
values
  (gen_random_uuid(), 'world.get.new', 't', 'test:shr:v1', now() - interval '400 hours',
   '00000000-0000-4000-8000-00000000cf02', 580, 573, 10, 10, 1, 5),
  (gen_random_uuid(), 'world.get.new', 't', 'test:shr:v2', now() - interval '30 hours',
   '00000000-0000-4000-8000-00000000cf02', 580, 573, 10, 10, 1, 5);
-- Server 573's listing read 20 and 10 days ago, 580's the same, and 573's seen 2 days ago.
select pg_temp.shop('test:shr:s1', 573, 7, 20);
select pg_temp.shop('test:shr:s2', 573, 7, 10);
select pg_temp.shop('test:shr:s3', 580, 7, 20);
select pg_temp.shop('test:shr:s4', 580, 7, 10);
select pg_temp.shop('test:shr:s5', 573, 8, 2);

set local role service_role;

select is((select rows from public.retention_purge() where relation = 'world_city_snapshots'), 2::bigint,
          'two sightings of the base are history; the newest and the lone old one are not');
select is((select rows from public.retention_purge() where relation = 'shop_listing_snapshots'), 1::bigint,
          'one superseded listing of another server; our two servers and fresh rows are not');

select is((select rows from public.retention_purge() where relation = 'world_truck_snapshots'), 1::bigint,
          'an older sighting of a truck is history, whatever its age');
select is((select rows from public.retention_purge() where relation = 'world_viewport_snapshots'), 1::bigint,
          'and an older sweep of the same area');

select * from public.retention_purge(true);

select is((select array_agg(idempotency_key) from public.world_truck_snapshots
            where idempotency_key like 'test:shr:t%'),
          array['test:shr:t2'], 'only the newest sighting of the truck stays');
select is((select array_agg(idempotency_key) from public.world_viewport_snapshots
            where idempotency_key like 'test:shr:v%'),
          array['test:shr:v2'], 'and only the newest sweep of the area');

select is((select count(*)::int from public.world_city_snapshots where idempotency_key like 'test:shr:c%'), 2,
          'the map keeps the newest of each base');
select is((select count(*)::int from public.world_city_snapshots where idempotency_key in ('test:shr:c1', 'test:shr:c2')), 0,
          'and drops the older sightings');
select is((select count(*)::int from public.shop_listing_snapshots where idempotency_key = 'test:shr:s1'), 0,
          'the older reading of another server''s listing is gone');
select is((select count(*)::int from public.shop_listing_snapshots where idempotency_key in ('test:shr:s2', 'test:shr:s5')), 2,
          'its newest readings stay');
select is((select count(*)::int from public.shop_listing_snapshots where idempotency_key in ('test:shr:s3', 'test:shr:s4')), 2,
          'server 580 keeps its whole history');

select ok((select count(*) from public.storage_report(5)) > 0, 'the storage report lists tables');
select ok((select max(total_bytes) from public.storage_report(5)) > 0, 'with their sizes');

select * from finish();
rollback;
