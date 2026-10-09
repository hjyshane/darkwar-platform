-- 0257: a truck known only from the interception list carries where it set off
-- from, and a truck with a march keeps its leg as before.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e011', 'truck-origin-test');

insert into public.world_truck_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, truck_uuid, owner_name, quality,
   start_pos, arrive_at, hero_fragments, goods)
values (gen_random_uuid(), 'train.list', 't', 'origin:list-only', now(),
        '00000000-0000-4000-8000-00000000e011', 580, 583, '9001', 'Lister', 5,
        706119, now() + interval '1 hour', 1, '[{"id":"210454","num":1}]'::jsonb);

select is((select origin_pos from public.world_trucks_latest where truck_uuid = '9001'), 706119,
  'a listed truck carries the point it left from');
select is((select target_pos from public.world_trucks_latest where truck_uuid = '9001'), null,
  'and has no leg, so no position of its own');

insert into public.world_truck_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, truck_uuid, quality,
   start_pos, target_pos, segment_start_at, segment_end_at, arrive_at)
values (gen_random_uuid(), 'push.world.march.new', 't', 'origin:leg', now(),
        '00000000-0000-4000-8000-00000000e011', 580, 583, '9001', 5,
        706119, 485422, now() - interval '1 minute', now() + interval '4 minutes',
        now() + interval '1 hour');

select is((select target_pos from public.world_trucks_latest where truck_uuid = '9001'), 485422,
  'once its march is seen the leg is there');
select is((select origin_pos from public.world_trucks_latest where truck_uuid = '9001'), 706119,
  'and the origin is still the list''s');

select * from finish();
rollback;
