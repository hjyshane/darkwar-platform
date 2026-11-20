-- 0339: re-anchoring a hive formation. The anchor goes somewhere else and
-- nothing on the map moves: every offset shifts the other way, and the tiles
-- that come back are the same tiles — same id, member, pin and assignment.
--
-- The packed row and the tile on the map's edge below are the two cases an
-- in-place UPDATE got wrong; both are here so that version never comes back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures: one own alliance, one player to stand on a tile, an officer who
-- placed them, an officer who re-anchors, and a member who may not.

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000003370a1', 580, 'ext-337', 'AnchorTest', true);
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-0000003370b1', 580, 9337000000000001, 'Pinned', 50),
  ('00000000-0000-4000-8000-0000003370b2', 580, 9337000000000002, 'Later', 40);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000003370c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anchor-placer@test.invalid'),
  ('00000000-0000-4000-8000-0000003370c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anchor-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000003370c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'anchor-member@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000003370c1', 'officer', 'anchor placer', null),
  ('00000000-0000-4000-8000-0000003370c2', 'officer', 'anchor officer', null),
  ('00000000-0000-4000-8000-0000003370c3', 'member', 'anchor member', null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

create function pg_temp.keep_assignments(state text) returns void language sql as $$
  select set_config('dw.hive_keep_assignment', state, true);
$$;

-- Where every tile of a formation stands on the map, in one comparable value.
create function pg_temp.ground(plan uuid) returns text language sql as $$
  select string_agg(format('%s:%s,%s', s.slot_id, f.anchor_x + s.dx, f.anchor_y + s.dy),
                    ' ' order by s.slot_id)
    from public.hive_formation_slots s
    join public.hive_formations f on f.formation_id = s.formation_id
   where s.formation_id = plan;
$$;

-- A packed row of three bases — 0, 3 and 6 across, each 3x3, touching — and
-- Frankie under the middle one. Shifting the anchor 3 east moves every offset
-- 3 west, onto the offset its neighbour holds until it moves too.
select pg_temp.act_as('00000000-0000-4000-8000-0000003370c1');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003370f1', 'Packed', 580, 500, 500);
insert into public.hive_formation_slots
  (slot_id, formation_id, dx, dy, ordinal, label, span_x, span_y, kind, colour, player_id, pinned)
values
  ('00000000-0000-4000-8000-0000003370e1', '00000000-0000-4000-8000-0000003370f1',
   0, 0, 1, 'flag', 3, 3, 'base', null, '00000000-0000-4000-8000-0000003370b1', true),
  ('00000000-0000-4000-8000-0000003370e2', '00000000-0000-4000-8000-0000003370f1',
   3, 0, 2, '', 3, 3, 'base', null, null, false),
  ('00000000-0000-4000-8000-0000003370e3', '00000000-0000-4000-8000-0000003370f1',
   6, 0, 3, '', 3, 3, 'base', null, null, false),
  ('00000000-0000-4000-8000-0000003370e4', '00000000-0000-4000-8000-0000003370f1',
   0, -3, 0, 'Frankie', 4, 3, 'structure', 'amber', null, false);

create temporary table before_reanchor as
select pg_temp.ground('00000000-0000-4000-8000-0000003370f1') as ground;

-- ---------------------------------------------------------------------------
-- The function.

select has_function('public', 'reanchor_hive_formation',
  array['uuid', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'reanchor_hive_formation exists');

select pg_temp.act_as('00000000-0000-4000-8000-0000003370c2');
select is(
  public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1', 1, 500, 500, 503, 500)
    - 'edited_at',
  jsonb_build_object('anchor_x', 503, 'anchor_y', 500, 'version', 2,
                     'edited_by_name', 'anchor officer'),
  'an officer puts the anchor three tiles east, and is told where it is now');

select is(
  (select (anchor_x, anchor_y)::text from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003370f1'),
  '(503,500)',
  'the anchor is on its new square');
select is(
  pg_temp.ground('00000000-0000-4000-8000-0000003370f1'),
  (select ground from before_reanchor),
  'and every tile stands exactly where it stood: nothing on the map moved');
select is(
  (select array_agg(dx order by slot_id) from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003370f1'),
  array[-3, 0, 3, -3],
  'because every offset moved three the other way — through a packed row');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003370f1'
      and slot_id in ('00000000-0000-4000-8000-0000003370e1', '00000000-0000-4000-8000-0000003370e2',
                      '00000000-0000-4000-8000-0000003370e3', '00000000-0000-4000-8000-0000003370e4')),
  4,
  'the tiles that came back are the same tiles, by id');
select is(
  (select (player_id, pinned, label, ordinal)::text from public.hive_formation_slots
    where slot_id = '00000000-0000-4000-8000-0000003370e1'),
  '(00000000-0000-4000-8000-0000003370b1,t,flag,1)',
  'with the same member on them, pinned, under the same caption and number');
select is(
  (select assigned_by from public.hive_formation_slots
    where slot_id = '00000000-0000-4000-8000-0000003370e1'),
  '00000000-0000-4000-8000-0000003370c1'::uuid,
  'and still credited to whoever put them there, not to whoever moved the anchor');
select is(
  (select (span_x, span_y, kind, colour)::text from public.hive_formation_slots
    where slot_id = '00000000-0000-4000-8000-0000003370e4'),
  '(4,3,structure,amber)',
  'Frankie keeps his size, kind and colour');
select is(
  current_setting('dw.hive_keep_assignment', true),
  'off',
  'the assignment stamp is back on once the tiles are down');

-- A NEW assignment after a re-anchor is stamped as usual: the switch that
-- kept the old ones does not leak into the next insert.
insert into public.hive_formation_slots (slot_id, formation_id, dx, dy, player_id)
values ('00000000-0000-4000-8000-0000003370e5', '00000000-0000-4000-8000-0000003370f1',
        -3, 6, '00000000-0000-4000-8000-0000003370b2');
select is(
  (select assigned_by from public.hive_formation_slots
    where slot_id = '00000000-0000-4000-8000-0000003370e5'),
  '00000000-0000-4000-8000-0000003370c2'::uuid,
  'a member put on a tile afterwards is stamped as usual, to whoever did it');
delete from public.hive_formation_slots where slot_id = '00000000-0000-4000-8000-0000003370e5';

-- ---------------------------------------------------------------------------
-- Stale.

select throws_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1',
       1, 503, 500, 500, 500) $$,
  'PT409', 'somebody else saved this plan after you opened it',
  'a re-anchor from a version that is gone is refused');
select throws_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1',
       2, 500, 500, 506, 500) $$,
  'PT409', 'the anchor was moved after you opened this plan',
  'so is one measured from where the anchor used to be');
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003370f1', 1,
       '[{"dx":0,"dy":0}]', null) $$,
  'PT409', 'somebody else saved this plan after you opened it',
  'and a draft drawn on the old offsets cannot be saved over the new ones');

select is(
  public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1', 2, 503, 500, 503, 500)
    ->> 'version',
  '2',
  'putting the anchor where it already is changes nothing, the version included');

-- A move after a re-anchor still moves everything: the two do not get in each
-- other's way.
select lives_ok(
  $$ select public.move_hive_formation('00000000-0000-4000-8000-0000003370f1',
       503, 500, 513, 500) $$,
  'the formation can still be moved as a whole afterwards');
select is(
  (select f.anchor_x + s.dx from public.hive_formation_slots s
     join public.hive_formations f using (formation_id)
    where s.slot_id = '00000000-0000-4000-8000-0000003370e1'),
  510,
  'and the tiles follow the anchor, as a move should');

-- ---------------------------------------------------------------------------
-- The edge of the map. A 1x1 on x = 0 and a 3x3 covering 1..3, anchor on 2.
-- Re-anchoring to 5 leaves both where they are; any order that moved the
-- anchor or the tiles first would have stood the 1x1 on x = -3 for a moment
-- and been refused by the on-map trigger.

select pg_temp.act_as('00000000-0000-4000-8000-0000003370c1');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003370f2', 'Edge', 580, 2, 500);
insert into public.hive_formation_slots (slot_id, formation_id, dx, dy, span_x, span_y, kind)
values
  ('00000000-0000-4000-8000-0000003370e6', '00000000-0000-4000-8000-0000003370f2',
   -2, 0, 1, 1, 'structure'),
  ('00000000-0000-4000-8000-0000003370e7', '00000000-0000-4000-8000-0000003370f2',
   0, 0, 3, 3, 'base');

select pg_temp.act_as('00000000-0000-4000-8000-0000003370c2');
select lives_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f2',
       1, 2, 500, 5, 500) $$,
  'a formation on the edge of the map can be re-anchored');
select is(
  pg_temp.ground('00000000-0000-4000-8000-0000003370f2'),
  '00000000-0000-4000-8000-0000003370e6:0,500 00000000-0000-4000-8000-0000003370e7:2,500',
  'and its tiles have not moved off it, or at all');

select throws_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f2',
       2, 5, 500, 0, 500) $$,
  '23514', null,
  'the anchor itself must still be on the map (1..998)');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003370f2'),
  2,
  'and a refused re-anchor loses no tiles');

-- ---------------------------------------------------------------------------
-- A deleted plan is restored before it is re-anchored.

select public.delete_hive_formation('00000000-0000-4000-8000-0000003370f2');
select throws_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f2',
       2, 5, 500, 6, 500) $$,
  'P0002', 'this plan was deleted',
  'a deleted plan cannot be re-anchored');

-- ---------------------------------------------------------------------------
-- §20.2: who may, through the real role.

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000003370c3');
select throws_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1',
       2, 513, 500, 514, 500) $$,
  '42501', null,
  'a member cannot re-anchor a plan');

select pg_temp.act_as('00000000-0000-4000-8000-0000003370c2');
select lives_ok(
  $$ select public.reanchor_hive_formation('00000000-0000-4000-8000-0000003370f1',
       2, 513, 500, 514, 500) $$,
  'an officer can, signed in as themselves');
-- The switch that keeps assignments, set by hand: it opens no door, because
-- the tiles were never the signed-in user's to write (0330).
select pg_temp.keep_assignments('on');
select throws_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy, player_id)
     values ('00000000-0000-4000-8000-0000003370f1', 30, 30,
             '00000000-0000-4000-8000-0000003370b2') $$,
  '42501', null,
  'and the setting that keeps assignments opens no door: the tiles are still not theirs to write');
select pg_temp.keep_assignments('off');

reset role;

select is(
  has_function_privilege('anon',
    'public.reanchor_hive_formation(uuid, integer, integer, integer, integer, integer)', 'execute'),
  false,
  'anon cannot re-anchor a plan');
select is(
  has_function_privilege('authenticated',
    'public.reanchor_hive_formation(uuid, integer, integer, integer, integer, integer)', 'execute'),
  true,
  'signed-in users reach it, and the function decides');

select * from finish();
rollback;
