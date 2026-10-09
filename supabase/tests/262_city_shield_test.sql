-- 0262: a base carries when its shield ends, through the latest view and the atlas.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e611', 'shield-test');

create function pg_temp.city(p_uid bigint, p_name text, p_shield timestamptz, p_at timestamptz)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid,
     point_id, x, y, name, hq_level, shield_end_at)
  values (gen_random_uuid(), 'world.get.new', 't', 'shield:' || p_uid::text || p_at::text, p_at,
          '00000000-0000-4000-8000-00000000e611', 580, 580, p_uid,
          21001, 20, 21, p_name, 30, p_shield);
$$;

-- One base seen twice: the newer sighting says shielded.
select pg_temp.city(9810000000000580, 'Shielded', null, now() - interval '2 hours');
select pg_temp.city(9810000000000580, 'Shielded', now() + interval '2 hours', now());
-- One never shielded.
select pg_temp.city(9810000000000581, 'Open', null, now());

select is((select shield_end_at is not null from public.latest_world_cities where game_uid = 9810000000000580),
  true, 'the newest sighting decides: shielded');
select is((select shield_end_at from public.latest_world_cities where game_uid = 9810000000000581),
  null, 'a base never shielded has none');
select ok((select (e ->> 8)::bigint > extract(epoch from now())
             from jsonb_array_elements(public.map_atlas(580) -> 'bases') e where e ->> 7 = 'Shielded'),
  'the atlas carries the shield end as an epoch, in the future for a live shield');
select is((select e -> 8 from jsonb_array_elements(public.map_atlas(580) -> 'bases') e where e ->> 7 = 'Open'),
  'null'::jsonb, 'and null for an unshielded base');

select * from finish();
rollback;
