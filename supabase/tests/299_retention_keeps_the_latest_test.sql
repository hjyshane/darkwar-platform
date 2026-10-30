-- 0299: retention ages out the history of a figure and never its latest value.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cf99', 'keep latest test', 'offline', 'test')
on conflict do nothing;
insert into public.servers (server_id, server_group) values (571, 'test') on conflict do nothing;
insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000099c1', 571, 9990000000000571, 'Stranger A'),
  ('00000000-0000-4000-8000-0000000099c2', 571, 9990000000001571, 'Stranger B');

-- The seed's readings are old enough to count; this test is about its own rows.
delete from public.player_component_power_snapshots where idempotency_key not like 'test:%';

create function pg_temp.put(p_key text, p_player uuid, p_uid bigint, p_metric text,
                            p_power bigint, p_days int)
returns void language sql as $$
  insert into public.player_component_power_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, metric, power)
  values (gen_random_uuid(), 'get.new.user.info', 't', p_key, now() - make_interval(days => p_days),
          '00000000-0000-4000-8000-00000000cf99', 571, p_player, 571, p_uid, p_metric, p_power);
$$;

-- Stranger A: migrate read twice (30 and 20 days ago), hero read twice (30 and 25).
select pg_temp.put('test:keep:a-mig-old', '00000000-0000-4000-8000-0000000099c1', 9990000000000571,
                   'migrate_power', 100, 30);
select pg_temp.put('test:keep:a-mig-new', '00000000-0000-4000-8000-0000000099c1', 9990000000000571,
                   'migrate_power', 120, 20);
select pg_temp.put('test:keep:a-hero-old', '00000000-0000-4000-8000-0000000099c1', 9990000000000571,
                   'hero_power_total', 5, 30);
select pg_temp.put('test:keep:a-hero-new', '00000000-0000-4000-8000-0000000099c1', 9990000000000571,
                   'hero_power_total', 6, 25);
-- Stranger B: one migrate and one hero reading, both 90 days old - the only ones there are.
select pg_temp.put('test:keep:b-mig', '00000000-0000-4000-8000-0000000099c2', 9990000000001571,
                   'migrate_power', 77, 90);
select pg_temp.put('test:keep:b-hero', '00000000-0000-4000-8000-0000000099c2', 9990000000001571,
                   'hero_power_total', 8, 90);

set local role service_role;

select is(
  (select rows from public.retention_purge() where relation = 'player_component_power_snapshots'),
  2::bigint,
  'counts only the two readings that were read again later');

select * from public.retention_purge(true);

select is(
  (select count(*)::int from public.player_component_power_snapshots
    where idempotency_key in ('test:keep:a-mig-old', 'test:keep:a-hero-old')),
  0, 'the superseded readings are purged');
select is(
  (select power from public.player_component_power_snapshots where idempotency_key = 'test:keep:a-mig-new'),
  120::bigint, 'the newest migration power of A survives');
select is(
  (select count(*)::int from public.player_component_power_snapshots
    where idempotency_key in ('test:keep:b-mig', 'test:keep:b-hero')),
  2, 'a figure read once, however long ago, is still the latest and survives');
select is(
  (select count(*)::int from public.player_component_power_snapshots where idempotency_key like 'test:keep:%'),
  4, 'four rows are left: the latest of each figure');

select * from finish();
rollback;
