-- 0250: the migration offer and its rules are read by officers and admins only,
-- the quotas function returns the newest row per server, and a duplicate capture
-- is refused by its key.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000b2001', 'migration-quota-test');

create function pg_temp.offer(p_key text, p_server int, p_at timestamptz, p_used int,
                              p_left jsonb default '{"1": 5}'::jsonb)
returns void language sql as $$
  insert into public.migration_server_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, total_count, use_count,
     migrate_left, power_low_limit)
  values (gen_random_uuid(), 'get.migrate.servers', 't', p_key, p_at,
          '00000000-0000-4000-8000-0000000b2001', 580, p_server, 60, p_used,
          p_left, array[10000000, 15000000, 25000000, 35000000]::bigint[]);
$$;

-- Server 581 twice (the second is newer), 584 once, and 999 - a server the group
-- does not track, which must not be refused.
select pg_temp.offer('mq:581:old', 581, now() - interval '2 hours', 12);
select pg_temp.offer('mq:581:new', 581, now() - interval '1 hour', 13, '{"1": 4}');
select pg_temp.offer('mq:584', 584, now() - interval '1 hour', 40, '{}');
select pg_temp.offer('mq:999', 999, now() - interval '1 hour', 0);

insert into public.migration_config_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, power_tier_floors, new_migrate_on)
values (gen_random_uuid(), 'init', 't', 'mq:config', now(),
        '00000000-0000-4000-8000-0000000b2001', 580,
        array[10000000, 15000000, 25000000, 35000000]::bigint[], false);

select is((select count(*)::int from public.migration_server_quotas()), 3,
  'one row per server, a server the group does not track included');
select is((select use_count from public.migration_server_quotas() where server_id = 581), 13,
  'the newest reading of a server is the one shown');
select is((select migrate_left ->> '1' from public.migration_server_quotas() where server_id = 581),
  '4', 'with its seats left per level');
select is((select power_low_limit from public.migration_server_quotas() where server_id = 581),
  array[10000000, 15000000, 25000000, 35000000]::bigint[], 'and the power floors');

select throws_ok(
  $$ select pg_temp.offer('mq:581:new', 581, now(), 13) $$,
  '23505', null, 'the same capture twice is refused by its key');

-- ------------------------------------------------------------ who can read it

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000b2301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mq-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000b2302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mq-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000b2301', 'member', 'mq member'),
  ('00000000-0000-4000-8000-0000000b2302', 'officer', 'mq officer');

select is(has_function_privilege('anon', 'public.migration_server_quotas()', 'execute'), false,
  'anon cannot run the quotas function');

set local role anon;
select throws_ok(
  $$ select * from public.migration_server_quotas() $$,
  '42501', null, 'anon is refused');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000b2301')::text, true);
select is_empty($$ select * from public.migration_server_quotas() $$,
  'a member reads no quotas');
select is_empty($$ select * from public.migration_config_snapshots $$,
  'and no config');
select throws_ok(
  $$ insert into public.migration_server_snapshots
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, server_id)
     values (gen_random_uuid(), 'x', 't', 'mq:member', now(),
             '00000000-0000-4000-8000-0000000b2001', 580, 581) $$,
  '42501', null, 'nobody signed in can write a snapshot');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000b2302')::text, true);
select is((select count(*)::int from public.migration_server_quotas()), 3,
  'an officer reads every server');
select is((select new_migrate_on from public.migration_config_snapshots limit 1), false,
  'and the config: the screen is off');
reset role;

select * from finish();
rollback;
