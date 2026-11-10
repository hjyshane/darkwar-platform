-- 0315: season sites. A member reads what is still standing, the newest state
-- of a site wins, what has expired or outlived its hour is gone, the game's
-- coordinate and the content group are computed, and a signed-in user with no
-- role reads nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ss-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ss-stranger@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'ss member');
-- f302 has no app_users row: signed in, but nobody the app knows.

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f001', 'site-test');

create function pg_temp.site(p_uuid text, p_x int, p_y int, p_cat int, p_status int,
                             p_expires timestamptz, p_at timestamptz default now(),
                             p_revealed timestamptz default null, p_limit int default null,
                             p_people jsonb default '[]'::jsonb)
returns void language sql as $$
  insert into public.season_site_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, point_id, x, y, site_uuid, cat_id,
     status, expires_at, revealed_at, limit_seconds, participant_uids)
  values (gen_random_uuid(), 'world.get.new', 't', 'ss:' || p_uuid || p_at::text || p_status, p_at,
          '00000000-0000-4000-8000-00000000f001', 580, 580, p_y * 1000 + p_x + 1, p_x, p_y,
          p_uuid, p_cat, p_status, p_expires, p_revealed, p_limit, p_people);
$$;

-- An unlit lantern hiding a Large Treasure Spot, the tile the game calls (453, 275).
select pg_temp.site('lantern', 454, 276, 1540, 3, now() + interval '2 hours');
-- A lantern that expired an hour ago.
select pg_temp.site('expired', 400, 698, 1525, 3, now() - interval '1 hour');
-- A lantern seen unlit ten minutes ago and lit since: the newer state wins.
select pg_temp.site('lit', 392, 660, 1538, 3, now() + interval '2 hours', now() - interval '10 minutes');
select pg_temp.site('lit', 392, 660, 1538, 0, now() + interval '2 hours', now());
-- An open Large Treasure Spot, revealed twenty minutes ago, with three people at it.
select pg_temp.site('open', 457, 262, 1530, 2, now() + interval '2 hours', now(),
                    now() - interval '20 minutes', 3600,
                    '["1000000000000580","1000000000000581","1000000000000582"]'::jsonb);
-- A site that opened two hours ago: its hour is over even though the expiry is not.
select pg_temp.site('closed', 866, 499, 1314, 2, now() + interval '2 hours', now(),
                    now() - interval '2 hours', 3600, '["1000000000000580"]'::jsonb);
-- A Daruma statue lantern: standing, but not treasure.
select pg_temp.site('daruma', 500, 500, 1440, 3, now() + interval '2 hours');

select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;

select is((select count(*)::int from public.season_sites_live), 4,
  'the lantern, the lit one, the open site and the daruma stand; expired and closed are gone');
select is((select status from public.season_sites_live where site_uuid = 'lit'), 0::smallint,
  'a site seen twice shows its newest state');
select is((select count(*)::int from public.season_sites_live where cat_group = 15), 3,
  'cat_group picks the Large Treasure Spots out by the hundreds of cat_id');
select is((select cat_group from public.season_sites_live where site_uuid = 'daruma'), 14,
  'and the daruma statue is 14');
select is((select (game_x, game_y) from public.season_sites_live where site_uuid = 'lantern'),
  (453, 275), 'the game''s coordinate is one less than the tile on both axes');
select is((select (x, y) from public.season_sites_live where site_uuid = 'lantern'),
  (454, 276), 'while the tile itself is kept for our own map');
select is((select participant_count from public.season_sites_live where site_uuid = 'open'), 3,
  'participants are counted, not listed');
select is((select participant_count from public.season_sites_live where site_uuid = 'lantern'), 0,
  'and an unlit lantern has nobody');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
set local role authenticated;
select is((select count(*)::int from public.season_site_snapshots), 0,
  'a user with no role reads no sites');
select is((select count(*)::int from public.season_sites_live), 0,
  'through the view either');

reset role;
select ok(not has_table_privilege('anon', 'public.season_sites_live', 'select'),
  'anon cannot read the view');

select * from finish();
rollback;
