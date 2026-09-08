-- 0165/0166/0167: the geometry that stops two members being sent to the same
-- ground, and the two functions that are the only safe way to write it.
--
-- THE ASSERTIONS THAT MATTER HERE ARE THE REFUSALS. A hive formation that is
-- merely stored is worth nothing; what makes it usable is that it CANNOT hold
-- two bases on one tile, cannot put a base where its 3x3 footprint would fall
-- off the world, and cannot name one member twice. Each of those was, before
-- this, something an officer found out in game after eighty people had already
-- teleported.
--
-- Unlike 83/87 there is nothing vacuous below: every row these assertions
-- need is inserted by the test, so they bite on an empty database too.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- The board's columns. `x` and `y` are the whole point — the instruction a
-- member reads — and `still_a_member` is what stops a fortnight-old plan
-- reading as if everybody named on it is still here.
select has_column('public', 'hive_formation_board', c.col,
  'hive_formation_board has ' || c.col)
from unnest(array['x', 'y', 'point_id', 'player_name', 'still_a_member', 'is_active'])
  as c(col);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.hive_formation_slots'::regclass
      and conname = 'hive_slots_do_not_overlap'
      and contype = 'x'),
  1,
  'the overlap rule is an exclusion constraint, not a convention');

-- MEMBERSHIP DOES NOT COME FROM players.current_alliance_id, per the standing
-- rule: nothing ever clears that column, so it says yes for everybody who
-- ever joined, and a "has this person left" flag built on it would always
-- say no.
select is(
  position('current_alliance_id' in
    pg_get_viewdef('public.hive_formation_board'::regclass)),
  0,
  'still_a_member is not read from the last-known alliance column');

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-00000000f001', 580, 'ext-hive', 'HiveTest', true);
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-00000000f101', 580, 9110000000000101, 'Alpha', 90),
  ('00000000-0000-4000-8000-00000000f102', 580, 9110000000000102, 'Bravo', 80),
  ('00000000-0000-4000-8000-00000000f103', 580, 9110000000000103, 'Leaver', 70);

-- Alpha and Bravo are on the newest roster; Leaver is not, which is what
-- `still_a_member` has to notice.
--
-- WRITTEN AS A REAL SNAPSHOT BATCH, columns and all. Every snapshot table
-- here carries observation_id, source_command, parser_version,
-- idempotency_key and captured_at, and every one of them is NOT NULL — a
-- three-column insert is not a shortcut, it is a row the table refuses. The
-- collector row exists because collector_id is a foreign key (0004).
--
-- One batch, one captured_at: `alliance_roster_latest` takes the newest
-- instant per alliance and returns every row sharing it, so two members
-- written a microsecond apart would leave the first one off the roster and
-- quietly turn assertion 26 into a tautology.
insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f0c1', 'hive probe');
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted)
select '00000000-0000-4000-8000-00000000f0b1', 'al.rank', 'test',
       'test:91:roster:' || v.game_uid, '2026-09-01T10:00:00Z',
       '00000000-0000-4000-8000-00000000f0c1', 580,
       '00000000-0000-4000-8000-00000000f001', 580, v.player_id,
       v.game_uid, v.name, 3, 30, v.power, false
from (values
    ('00000000-0000-4000-8000-00000000f101'::uuid, 9110000000000101::bigint, 'Alpha', 90::bigint),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 9110000000000102::bigint, 'Bravo', 80::bigint)
  ) as v(player_id, game_uid, name, power);

-- The three readers, set up here rather than beside the RLS assertions
-- because the two write functions gate on `has_permission`, which reads the
-- JWT claim and not the database role. Run as the bare superuser this suite
-- connects as, `current_app_role()` is 'viewer' and every call below would be
-- refused for the wrong reason.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hive-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hive-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'hive-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'viewer', 'hive viewer'),
  ('00000000-0000-4000-8000-00000000f302', 'member', 'hive member'),
  ('00000000-0000-4000-8000-00000000f303', 'officer', 'hive officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.hive_formations
  (formation_id, name, server_id, anchor_x, anchor_y, is_active)
values ('00000000-0000-4000-8000-00000000f201', 'Hive move', 580, 500, 500, true);

-- A PACKED HIVE IS CENTRES 3 APART. The base covers dx-1..dx+1, so 3 apart
-- means the footprints touch and share nothing, which is exactly the shape an
-- officer is drawing.
select lives_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy, ordinal) values
       ('00000000-0000-4000-8000-00000000f201', 0, 0, 1),
       ('00000000-0000-4000-8000-00000000f201', 3, 0, 2),
       ('00000000-0000-4000-8000-00000000f201', 0, 3, 3),
       -- West of the anchor on purpose: a formation drawn only to the east
       -- can never be pushed off the left edge, and the anchor-move refusal
       -- below would pass without testing anything.
       ('00000000-0000-4000-8000-00000000f201', -3, 0, 4) $$,
  'centres three tiles apart pack without overlapping');

-- Two apart on BOTH axes shares a tile. This is the failure the whole table
-- exists to prevent: 500,500 and 502,502 read as two squares and are one
-- piece of ground.
select throws_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy)
     values ('00000000-0000-4000-8000-00000000f201', 2, 2) $$,
  '23P01', null,
  'two apart on both axes is refused — the footprints share a tile');

-- Two apart on ONE axis is not an overlap: the other axis separates them.
select lives_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy)
     values ('00000000-0000-4000-8000-00000000f201', 2, 6) $$,
  'two apart on one axis only is a legal neighbour');

-- Another formation may be drawn over the same ground. Planning an
-- alternative must not require abandoning the current plan.
insert into public.hive_formations
  (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-00000000f202', 'Alternative', 580, 500, 500);
select lives_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy)
     values ('00000000-0000-4000-8000-00000000f202', 0, 0) $$,
  'a second formation may occupy the same tiles');

select throws_ok(
  $$ insert into public.hive_formations (name, server_id, anchor_x, anchor_y, is_active)
     values ('Second live plan', 580, 400, 400, true) $$,
  '23505', null,
  'only one formation per server may be the live one');

-- A 3x3 centred on 999 needs a column of tiles that does not exist.
select throws_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy)
     values ('00000000-0000-4000-8000-00000000f201', 499, 0) $$,
  '23514', null,
  'a slot whose footprint leaves the map is refused');

-- The same rule from the other side, and the reason it needs its own trigger:
-- moving the anchor is the one edit that can push eighty slots off the world
-- at once, and no check constraint on either table can see both halves.
select throws_ok(
  $$ update public.hive_formations set anchor_x = 2
      where formation_id = '00000000-0000-4000-8000-00000000f201' $$,
  '23514', null,
  'moving the anchor somewhere the formation would not fit is refused');

select lives_ok(
  $$ update public.hive_formations set anchor_x = 600
      where formation_id = '00000000-0000-4000-8000-00000000f201' $$,
  'moving it somewhere it does fit is allowed');

update public.hive_formation_slots
   set player_id = '00000000-0000-4000-8000-00000000f101'
 where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 0 and dy = 0;

select throws_ok(
  $$ update public.hive_formation_slots
        set player_id = '00000000-0000-4000-8000-00000000f101'
      where formation_id = '00000000-0000-4000-8000-00000000f201'
        and dx = 3 and dy = 0 $$,
  '23505', null,
  'a member cannot be sent to two tiles at once');

-- The instruction itself: anchor plus offset, computed server-side.
select is(
  (select x || ', ' || y from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 0 and dy = 0),
  '600, 500',
  'the board adds the anchor to the offset');

select is(
  (select point_id from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 0 and dy = 0),
  600500::bigint,
  'and packs it the way the game does');

-- From here the write functions are exercised, so the caller has to be
-- somebody the permission grid recognises. Still the superuser at the
-- database level — RLS is not what these five assertions are about.
select pg_temp.act_as('00000000-0000-4000-8000-00000000f303');

-- SHIFTING THE WHOLE SHAPE. Every new slot overlaps the old slot it replaces,
-- so this succeeds only because the function deletes before it inserts —
-- which is the thing a client doing three PostgREST calls cannot promise.
select lives_ok(
  $$ select public.save_hive_formation_layout(
       '00000000-0000-4000-8000-00000000f201',
       '[{"dx":0,"dy":0,"ordinal":1},{"dx":3,"dy":0,"ordinal":2},
         {"dx":1,"dy":3,"ordinal":3}]'::jsonb) $$,
  'a layout that overlaps its own previous version saves');

-- A tile that survived the redraw keeps the member standing on it. Redrawing
-- the far side of a hive must not empty the near side.
select is(
  (select player_id from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 0 and dy = 0),
  '00000000-0000-4000-8000-00000000f101'::uuid,
  'an assignment survives a redraw that keeps its tile');

select is(
  (public.save_hive_formation_layout(
     '00000000-0000-4000-8000-00000000f201',
     '[{"dx":3,"dy":0,"ordinal":2}]'::jsonb) ->> 'unassigned')::int,
  1,
  'and a redraw that removes an occupied tile says how many it emptied');

select throws_ok(
  $$ select public.save_hive_formation_layout(
       '00000000-0000-4000-8000-00000000f201',
       '[{"dx":0,"dy":0},{"dx":2,"dy":1}]'::jsonb) $$,
  '23514', null,
  'an overlapping layout is refused with the offsets named');

-- SWAPPING TWO MEMBERS. There is no order of two single-row updates that does
-- not break `hive_slot_one_place_per_member` halfway, which is why assignment
-- is a whole-formation call.
select public.save_hive_formation_layout(
  '00000000-0000-4000-8000-00000000f201',
  '[{"dx":0,"dy":0,"ordinal":1},{"dx":3,"dy":0,"ordinal":2}]'::jsonb);
select public.assign_hive_formation_slots(
  '00000000-0000-4000-8000-00000000f201',
  (select jsonb_agg(jsonb_build_object('slot_id', slot_id, 'player_id',
     case when dx = 0 then '00000000-0000-4000-8000-00000000f101'
          else '00000000-0000-4000-8000-00000000f102' end))
   from public.hive_formation_slots
   where formation_id = '00000000-0000-4000-8000-00000000f201'));
select lives_ok(
  $$ select public.assign_hive_formation_slots(
       '00000000-0000-4000-8000-00000000f201',
       (select jsonb_agg(jsonb_build_object('slot_id', slot_id, 'player_id',
          case when dx = 0 then '00000000-0000-4000-8000-00000000f102'
               else '00000000-0000-4000-8000-00000000f101' end))
        from public.hive_formation_slots
        where formation_id = '00000000-0000-4000-8000-00000000f201')) $$,
  'two members swap tiles in one call');

select throws_ok(
  $$ select public.assign_hive_formation_slots(
       '00000000-0000-4000-8000-00000000f201',
       (select jsonb_agg(jsonb_build_object('slot_id', slot_id,
          'player_id', '00000000-0000-4000-8000-00000000f101'))
        from public.hive_formation_slots
        where formation_id = '00000000-0000-4000-8000-00000000f201')) $$,
  '23505', null,
  'naming one member on two tiles is refused before anything is written');

-- Somebody who has left is still named on the tile, and the board says so.
update public.hive_formation_slots
   set player_id = '00000000-0000-4000-8000-00000000f103'
 where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 3;
select is(
  (select still_a_member from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-00000000f201' and dx = 3),
  false,
  'a tile assigned to somebody off the newest roster is flagged');

-- §20.2: the negative half, through RLS rather than through the screen.
set local role authenticated;

-- Where the alliance is about to put its hive is exactly what a rival would
-- like to know, so a signed-in stranger gets nothing.
select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
select is(
  (select count(*)::int from public.hive_formations), 0,
  'a viewer reads no formation at all');

-- And every member does read it: the whole feature is telling eighty people
-- where to stand, so a plan only officers can see is a plan executed wrong.
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
select isnt(
  (select count(*)::int from public.hive_formation_board), 0,
  'a member reads the board they are being told to follow');

select throws_ok(
  $$ insert into public.hive_formations (name, server_id, anchor_x, anchor_y)
     values ('Member drawing', 580, 300, 300) $$,
  '42501', null,
  'a member cannot draw one');

select throws_ok(
  $$ select public.save_hive_formation_layout(
       '00000000-0000-4000-8000-00000000f201', '[]'::jsonb) $$,
  '42501', null,
  'nor reach the tiles through the function that writes them');

select pg_temp.act_as('00000000-0000-4000-8000-00000000f303');
select lives_ok(
  $$ select public.save_hive_formation_layout(
       '00000000-0000-4000-8000-00000000f201',
       '[{"dx":0,"dy":0,"ordinal":1}]'::jsonb) $$,
  'an officer can — the gate sits between member and officer');

reset role;

select * from finish();
rollback;
