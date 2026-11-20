-- 0340: a mission leaves dispatch_missions_live once a later viewport over its
-- tile lists the missions it saw and does not name it - and only then.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000340f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mission-gone@test.invalid'),
  ('00000000-0000-4000-8000-0000000340f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mission-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000340f1', 'member', 'mission gone'),
  ('00000000-0000-4000-8000-0000000340f2', 'viewer', 'mission viewer');
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000340c1', 'mission-gone-test');

insert into public.game_dispatch_missions
  (mission_id, color, star, duration_seconds, steal_max, orange_books)
values (9934001, 4, 2, 7200, 3, 6);

-- Eight missions, seven on 566, all last seen an hour ago, all with an hour to run.
-- Each stands where exactly one of the viewports below can speak about it.
insert into public.dispatch_mission_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, point_id, x, y, mission_id, mission_uuid,
   owner_game_uid, alliance_external_id, started_at, ends_at, raw)
select gen_random_uuid(), 'world.get.new', '1.8.0', 'mg:' || m.id, now() - interval '1 hour',
       '00000000-0000-4000-8000-0000000340c1', 580, 566, m.y * 1000 + m.x + 1, m.x, m.y,
       9934001, m.id, null, null, now() - interval '2 hours', now() + interval '1 hour',
       '{"103": [566]}'
  from (values
    ('m-340-gone',    100, 100),  -- a later pan over it does not name it
    ('m-340-there',   110, 110),  -- the same pan names it
    ('m-340-unseen',  500, 500),  -- nobody looked again
    ('m-340-oldpan',  300, 300),  -- the pan over it is from BEFORE its sighting
    ('m-340-nolist',  700, 300),  -- a later pan from a parser that kept no list
    ('m-340-edge',    135, 100),  -- on the window's last column: not claimed
    ('m-340-zoom',    300, 700),  -- a later pan at viewLvl 0
    ('m-340-other',   100, 100)   -- same tile, another server's map
  ) as m(id, x, y);
update public.dispatch_mission_snapshots
   set server_id = 567, raw = '{"103": [567]}'
 where mission_uuid = 'm-340-other';

insert into public.world_viewport_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, center_x, center_y, view_lvl,
   object_count, raw)
select gen_random_uuid(), 'world.get.new', v.parser, 'mg:vp:' || v.id, now() - v.age,
       '00000000-0000-4000-8000-0000000340c1', 580, 566, v.cx, v.cy, v.lvl, 1, v.raw::jsonb
  from (values
    ('late',   '1.8.0', interval '10 minutes', 100, 100, 1, '{"missions": ["m-340-there"]}'),
    ('early',  '1.8.0', interval '3 hours',    300, 300, 1, '{"missions": []}'),
    ('nolist', '1.7.0', interval '10 minutes', 700, 300, 1, '{}'),
    ('zoom',   '1.8.0', interval '10 minutes', 300, 700, 0, '{"missions": []}')
  ) as v(id, parser, age, cx, cy, lvl, raw);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000340f1')::text, true);
set local role authenticated;

create function pg_temp.listed(p_uuid text) returns int language sql as $$
  select count(*)::int from public.dispatch_missions_live where mission_uuid = p_uuid;
$$;

select is(pg_temp.listed('m-340-gone'), 0,
  'a mission a later pan over its tile does not name is gone');
select is(pg_temp.listed('m-340-there'), 1,
  'a mission that pan names stays, though its own row is an hour older');
select is(pg_temp.listed('m-340-unseen'), 1,
  'a mission nobody looked at again stays until its finish instant');
select is(pg_temp.listed('m-340-oldpan'), 1,
  'a pan from before the sighting says nothing about it');
select is(pg_temp.listed('m-340-nolist'), 1,
  'a viewport row with no list says nothing: every row before parser 1.8.0');
select is(pg_temp.listed('m-340-edge'), 1,
  'the window''s last column is not claimed');
select is(pg_temp.listed('m-340-zoom'), 1,
  'a viewLvl 0 pan is not evidence: its window was never measured');
select is(pg_temp.listed('m-340-other'), 1,
  'a pan of one server''s map says nothing about another''s');

-- The view is security_invoker over member-read tables: a viewer reads nothing.
-- The rows are there (the member counted them above), so 0 is the refusal.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000340f2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.dispatch_missions_live
            where mission_uuid like 'm-340-%'), 0,
  'a viewer sees no mission');
select is((select count(*)::int from public.world_viewport_snapshots
            where idempotency_key like 'mg:vp:%'), 0,
  'nor where the camera looked');

select * from finish();
rollback;
