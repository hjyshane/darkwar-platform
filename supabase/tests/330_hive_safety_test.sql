-- 0330: hive safety. A stale save is refused, a deleted plan can be brought
-- back for 30 days, and every plan says who last changed it.
--
-- The refusals are the point, as in 91: each one below is a way two officers
-- used to lose each other's work without being told.
begin;
create extension if not exists pgtap with schema extensions;

select plan(98);

-- ---------------------------------------------------------------------------
-- Fixtures. The same shape 91 uses: one own alliance, a few players, and
-- accounts whose role decides `has_permission`, which reads the JWT claim
-- rather than the database role.

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000003290a1', 580, 'ext-329', 'SafeTest', true);
insert into public.players (player_id, server_id, game_uid, current_name, power) values
  ('00000000-0000-4000-8000-0000003290b1', 580, 9329000000000001, 'Mina', 50),
  ('00000000-0000-4000-8000-0000003290b2', 580, 9329000000000002, 'Alpha', 90),
  ('00000000-0000-4000-8000-0000003290b3', 580, 9329000000000003, 'Bravo', 80);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000003290c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'safe-member@test.invalid'),
  ('00000000-0000-4000-8000-0000003290c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'safe-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000003290c4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'safe-mina@test.invalid'),
  ('00000000-0000-4000-8000-0000003290c5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'safe-nameless@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000003290c2', 'member', 'safe member', null),
  ('00000000-0000-4000-8000-0000003290c3', 'officer', 'safe officer', null),
  -- Linked to a character: the stamp should read the character's name.
  ('00000000-0000-4000-8000-0000003290c4', 'officer', 'mina account',
   '00000000-0000-4000-8000-0000003290b1'),
  -- Neither a character nor a display name: the stamp is null, and the site
  -- says "someone".
  ('00000000-0000-4000-8000-0000003290c5', 'officer', null, null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ---------------------------------------------------------------------------
-- The columns.

select has_column('public', 'hive_formations', c.col, 'hive_formations has ' || c.col)
from unnest(array['version', 'edited_at', 'edited_by', 'edited_by_name',
                  'deleted_at', 'deleted_by', 'deleted_by_name']) as c(col);

select col_default_is('public', 'hive_formations', 'version', '1',
  'a new plan starts at version 1');

select has_column('public', 'hive_formation_board', 'formation_version',
  'the board says which version of the plan it was read from');

-- ---------------------------------------------------------------------------
-- The stamp on creation.

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y, is_active)
values ('00000000-0000-4000-8000-0000003290f1', 'Safe live', 580, 500, 500, true);
insert into public.hive_formation_slots (formation_id, dx, dy)
values ('00000000-0000-4000-8000-0000003290f1', 0, 0);

select is(
  (select edited_by from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  '00000000-0000-4000-8000-0000003290c3'::uuid,
  'a new plan was last changed by whoever created it');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  'safe officer',
  'and names them by the display name when they have no character');

-- A direct insert is still allowed (creating a plan), so it must not be able
-- to forge what only the functions are meant to write.
insert into public.hive_formations
  (formation_id, name, server_id, anchor_x, anchor_y, version, deleted_at,
   edited_by, edited_by_name)
values ('00000000-0000-4000-8000-0000003290f2', 'Safe draft', 580, 400, 400, 9, now(),
        '00000000-0000-4000-8000-0000003290c4', 'forged');

select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f2'),
  1,
  'an insert cannot start a plan at a later version');
select is(
  (select deleted_at from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f2'),
  null,
  'nor create it already deleted');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f2'),
  'safe officer',
  'nor put somebody else''s name on it');

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c4');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003290f3', 'Mina plan', 580, 300, 300);
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f3'),
  'Mina',
  'a linked account is named by its character, as post_authors does');

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c5');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003290f4', 'Nameless plan', 580, 200, 200);
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f4'),
  null,
  'an account with no name leaves the stamp empty rather than inventing one');

-- ---------------------------------------------------------------------------
-- Delete keeps the row.

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
select public.delete_hive_formation('00000000-0000-4000-8000-0000003290f1');

select isnt(
  (select deleted_at from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  null,
  'deleting marks the plan deleted instead of removing it');
select is(
  (select deleted_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  'safe officer',
  'and says who deleted it');
select is(
  (select is_active from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  false,
  'a deleted plan stops being the live one');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  1,
  'deleting is not an edit: the version is untouched');

-- Pressing Delete twice is not an error, and the second press does not
-- re-credit the delete to whoever pressed second.
select pg_temp.act_as('00000000-0000-4000-8000-0000003290c4');
select lives_ok(
  $$ select public.delete_hive_formation('00000000-0000-4000-8000-0000003290f1') $$,
  'deleting an already deleted plan is a no-op');
select is(
  (select deleted_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  'safe officer',
  'and the first delete keeps its name');

-- ---------------------------------------------------------------------------
-- §20.2: who sees a deleted plan, through RLS.

set local role authenticated;

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c2');
select is(
  (select count(*)::int from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  0,
  'a member does not see a deleted plan');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  0,
  'nor its tiles');
select is(
  (select count(*)::int from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  0,
  'nor its board');
select is(
  (select count(*)::int from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f2'),
  1,
  'while a plan that is not deleted is still there for them');

select throws_ok(
  $$ select public.delete_hive_formation('00000000-0000-4000-8000-0000003290f2') $$,
  '42501', null,
  'a member cannot delete a plan');
select throws_ok(
  $$ select public.restore_hive_formation('00000000-0000-4000-8000-0000003290f1') $$,
  '42501', null,
  'nor restore one');

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
select is(
  (select count(*)::int from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  1,
  'an officer still sees the deleted plan, to restore it');
select is(
  (select count(*)::int from public.hive_formation_board
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  0,
  'but the board, which members are told to follow, leaves it out for everybody');

reset role;

-- ---------------------------------------------------------------------------
-- Restore.

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c4');
-- RESTORE KEEPS THE VERSION. The plan comes back exactly as it was before
-- the delete, and nothing can be saved to a deleted plan, so a draft built on
-- that version is still a draft of this plan: the officer who had it open
-- when somebody else pressed Delete restores it and saves, rather than being
-- told their work is stale and losing it to "Load the new version".
select is(
  (public.restore_hive_formation('00000000-0000-4000-8000-0000003290f1') ->> 'version')::int,
  1,
  'restoring keeps the version, so a draft open before the delete can still be saved');
select is(
  (select deleted_at from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  null,
  'the plan is back');
select is(
  (select is_active from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  false,
  'but not live: another plan may have taken that place');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  'Mina',
  'and the restorer is the last to have changed it');

select lives_ok(
  $$ select public.restore_hive_formation('00000000-0000-4000-8000-0000003290f1') $$,
  'restoring a plan that is not deleted is a no-op');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f1'),
  1,
  'and does not move the version');

select throws_ok(
  $$ select public.restore_hive_formation('00000000-0000-4000-8000-0000003290ff') $$,
  'P0002', null,
  'a plan that does not exist (or was purged) cannot be restored');

-- ---------------------------------------------------------------------------
-- The cleanup: 30 days, then gone. Back-dated as the owner, with no claims,
-- the way the cron job runs.

select set_config('request.jwt.claims', '{}', true);
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003290e1', 'Old', 580, 100, 100),
       ('00000000-0000-4000-8000-0000003290e2', 'Recent', 580, 110, 110),
       ('00000000-0000-4000-8000-0000003290e3', 'Kept', 580, 120, 120);
insert into public.hive_formation_slots (formation_id, dx, dy)
values ('00000000-0000-4000-8000-0000003290e1', 0, 0);
update public.hive_formations set deleted_at = now() - interval '31 days'
 where formation_id = '00000000-0000-4000-8000-0000003290e1';
update public.hive_formations set deleted_at = now() - interval '29 days'
 where formation_id = '00000000-0000-4000-8000-0000003290e2';

select is(internal.purge_deleted_hive_formations(), 1,
  'the cleanup removes exactly the plan deleted more than 30 days ago');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290e1'),
  0,
  'and its tiles with it');
select is(
  (select count(*)::int from public.hive_formations
    where formation_id in ('00000000-0000-4000-8000-0000003290e2',
                           '00000000-0000-4000-8000-0000003290e3')),
  2,
  'a plan deleted 29 days ago and a plan never deleted both stay');

-- The cron.job row is not asserted: the local stub has no cron.job table (258).

-- ---------------------------------------------------------------------------
-- Who may call what. anon holds nothing (0168); the internal helpers are not
-- endpoints at all.

select is(has_function_privilege('anon', 'public.delete_hive_formation(uuid)', 'execute'),
  false, 'anon cannot delete a plan');
select is(has_function_privilege('anon', 'public.restore_hive_formation(uuid)', 'execute'),
  false, 'anon cannot restore a plan');
select is(has_function_privilege('authenticated', 'internal.purge_deleted_hive_formations()', 'execute'),
  false, 'the cleanup is not callable from the site');
select is(has_function_privilege('authenticated', 'internal.hive_formation_lock(uuid)', 'execute'),
  false, 'nor is the lock helper');

-- ===========================================================================
-- The checked writes.

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y)
values ('00000000-0000-4000-8000-0000003290d1', 'Checked', 580, 600, 600),
       ('00000000-0000-4000-8000-0000003290d2', 'To delete', 580, 700, 700);

-- A plan with no tiles yet has no board rows to carry a version; its first
-- save still works from version 1.
select is(
  (public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 1,
     '[{"dx":0,"dy":0},{"dx":3,"dy":0}]', '[]') ->> 'version')::int,
  2,
  'the first save of an empty plan moves it to version 2');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  2,
  'and writes its tiles');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  'safe officer',
  'and stamps whoever saved');

-- THE REFUSAL THIS FILE EXISTS FOR.
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 1,
       '[{"dx":0,"dy":0}]', '[]') $$,
  'PT409', 'somebody else saved this plan after you opened it',
  'a save made from version 1 after the plan reached version 2 is refused');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  2,
  'and writes nothing: the newer shape is intact');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  2,
  'nor moves the version');

-- The people alone.
select lives_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 2, null,
       '[{"dx":0,"dy":0,"player_id":"00000000-0000-4000-8000-0000003290b2","pinned":true}]') $$,
  'the people can be saved without the shape');
select is(
  (select player_id from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1' and dx = 0 and dy = 0),
  '00000000-0000-4000-8000-0000003290b2'::uuid,
  'a member is placed by the offset of their tile, not its id');
select is(
  (select pinned from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1' and dx = 0 and dy = 0),
  true,
  'with their pin');
select is(
  (select player_id from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1' and dx = 3 and dy = 0),
  null,
  'and a tile the payload does not name is empty');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  3,
  'a people-only save is an edit too');

-- The shape and the people together, in one call: the member rides with the
-- square they stand on even though a moved tile gets a new id.
select is(
  (public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 3,
     '[{"dx":6,"dy":0},{"dx":3,"dy":0}]',
     '[{"dx":6,"dy":0,"player_id":"00000000-0000-4000-8000-0000003290b2","pinned":true}]')
     ->> 'lost')::int,
  0,
  'moving a member''s tile with the member on it loses nobody');
select is(
  (select player_id from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1' and dx = 6 and dy = 0),
  '00000000-0000-4000-8000-0000003290b2'::uuid,
  'they stand on the tile at its new place');
select is(
  (public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 4,
     '[{"dx":3,"dy":0}]', '[]') ->> 'lost')::int,
  1,
  'erasing the tile somebody stood on is reported as one member losing their tile');

-- Assignments that name no place are refused whole.
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 5, null,
       '[{"dx":9,"dy":9,"player_id":"00000000-0000-4000-8000-0000003290b3"}]') $$,
  '23503', null,
  'a member sent to an offset with no tile is refused');
select lives_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 5,
       '[{"dx":3,"dy":0},{"dx":20,"dy":20,"kind":"structure","span_x":1,"span_y":1}]', '[]') $$,
  'a structure can be drawn');
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 6, null,
       '[{"dx":20,"dy":20,"player_id":"00000000-0000-4000-8000-0000003290b3"}]') $$,
  '23514', null,
  'a member sent to a structure is refused');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  6,
  'and a refused save leaves the version where it was');
select is(
  (select count(*)::int from public.hive_formation_slots
    where formation_id = '00000000-0000-4000-8000-0000003290d1'
      and player_id = '00000000-0000-4000-8000-0000003290b3'),
  0,
  'with the member nowhere');

select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 6, null,
       '[{"dx":3,"dy":0,"player_id":"00000000-0000-4000-8000-0000003290b2"},
         {"dx":3,"dy":0,"player_id":"00000000-0000-4000-8000-0000003290b3"}]') $$,
  '22023', 'two people were sent to the same tile in one save',
  'two people sent to one tile in the same save are refused, not settled by chance');

select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 6, null, null) $$,
  '22023', null,
  'a save with neither a shape nor people is a mistake, not a version bump');

select public.delete_hive_formation('00000000-0000-4000-8000-0000003290d2');
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d2', 1, '[]', '[]') $$,
  'P0002', 'this plan was deleted',
  'a deleted plan cannot be saved over');

-- ---------------------------------------------------------------------------
-- The anchor: checked against the anchor the mover saw, not the version.

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c4');
select is(
  (public.move_hive_formation('00000000-0000-4000-8000-0000003290d1', 600, 600, 610, 600)
     ->> 'anchor_x')::int,
  610,
  'an officer moves the anchor');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  6,
  'which does not make anybody''s unsaved draft stale');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  'Mina',
  'but does say who moved it, because every member''s coordinate changed');

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
select throws_ok(
  $$ select public.move_hive_formation('00000000-0000-4000-8000-0000003290d1',
       600, 600, 590, 600) $$,
  'PT409', 'the anchor was moved after you opened this plan',
  'a second officer moving from where the anchor used to be is refused');
select lives_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 6, null, '[]') $$,
  'while a save made before the move still goes through');
select is(
  (select edited_by_name from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d1'),
  'safe officer',
  'and the stamp follows the latest change');

-- ---------------------------------------------------------------------------
-- Make-live: one call, never two live and never none.

select lives_ok(
  $$ select public.make_hive_formation_live('00000000-0000-4000-8000-0000003290f2') $$,
  'a plan is made live');
select lives_ok(
  $$ select public.make_hive_formation_live('00000000-0000-4000-8000-0000003290f3') $$,
  'and another one in its place');
select is(
  (select array_agg(formation_id order by formation_id) from public.hive_formations
    where is_active and server_id = 580),
  array['00000000-0000-4000-8000-0000003290f3'::uuid],
  'the first stood down in the same call');
select is(
  (select version from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f3'),
  1,
  'making a plan live is not an edit');

select throws_ok(
  $$ select public.make_hive_formation_live('00000000-0000-4000-8000-0000003290d2') $$,
  'P0002', 'this plan was deleted',
  'a deleted plan cannot be made live');
select is(
  (select is_active from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f3'),
  true,
  'and the refusal leaves the live plan live');

select public.restore_hive_formation('00000000-0000-4000-8000-0000003290d2');
select public.make_hive_formation_live('00000000-0000-4000-8000-0000003290d2');
select is(
  (select is_active from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290f3'),
  false,
  'a restored plan made live stands the old live plan down');
select is(
  (select is_active from public.hive_formations
    where formation_id = '00000000-0000-4000-8000-0000003290d2'),
  true,
  'and takes its place');

-- ---------------------------------------------------------------------------
-- §20.2: the doors the functions replace are shut, through the real role.

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');

select throws_ok(
  $$ update public.hive_formations set anchor_x = 1
      where formation_id = '00000000-0000-4000-8000-0000003290d1' $$,
  '42501', null,
  'an officer cannot move an anchor around the check');
select throws_ok(
  $$ update public.hive_formations set is_active = true
      where formation_id = '00000000-0000-4000-8000-0000003290d1' $$,
  '42501', null,
  'nor make a plan live in two requests');
select throws_ok(
  $$ delete from public.hive_formations
      where formation_id = '00000000-0000-4000-8000-0000003290d1' $$,
  '42501', null,
  'nor delete a plan for good');
select throws_ok(
  $$ insert into public.hive_formation_slots (formation_id, dx, dy)
     values ('00000000-0000-4000-8000-0000003290d1', 30, 30) $$,
  '42501', null,
  'nor add a tile directly');
select throws_ok(
  $$ update public.hive_formation_slots set label = 'x'
      where formation_id = '00000000-0000-4000-8000-0000003290d1' $$,
  '42501', null,
  'nor change one');
select throws_ok(
  $$ delete from public.hive_formation_slots
      where formation_id = '00000000-0000-4000-8000-0000003290d1' $$,
  '42501', null,
  'nor erase one');
select throws_ok(
  $$ select public.save_hive_formation_layout('00000000-0000-4000-8000-0000003290d1', '[]') $$,
  '42501', null,
  'nor call the old shape save, which checks no version');
select throws_ok(
  $$ select public.assign_hive_formation_slots('00000000-0000-4000-8000-0000003290d1', '[]') $$,
  '42501', null,
  'nor the old people save');
select lives_ok(
  $$ insert into public.hive_formations (name, server_id, anchor_x, anchor_y)
     values ('Fresh', 580, 800, 800) $$,
  'creating a plan is still a direct insert');

select pg_temp.act_as('00000000-0000-4000-8000-0000003290c2');
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d1', 7, null, '[]') $$,
  '42501', null,
  'a member cannot save a plan');
select throws_ok(
  $$ select public.move_hive_formation('00000000-0000-4000-8000-0000003290d1',
       610, 600, 620, 600) $$,
  '42501', null,
  'nor move one');
select throws_ok(
  $$ select public.make_hive_formation_live('00000000-0000-4000-8000-0000003290d1') $$,
  '42501', null,
  'nor make one live');

reset role;

select is(has_function_privilege('anon', 'public.save_hive_formation(uuid, integer, jsonb, jsonb)', 'execute'),
  false, 'anon cannot save a plan');
select is(has_function_privilege('anon', 'public.move_hive_formation(uuid, integer, integer, integer, integer)', 'execute'),
  false, 'anon cannot move one');
select is(has_function_privilege('anon', 'public.make_hive_formation_live(uuid)', 'execute'),
  false, 'anon cannot make one live');
select is(has_function_privilege('authenticated', 'public.save_hive_formation_layout(uuid, jsonb)', 'execute'),
  false, 'the old shape save is no longer an endpoint');
select is(has_function_privilege('authenticated', 'public.assign_hive_formation_slots(uuid, jsonb)', 'execute'),
  false, 'nor the old people save');

-- ---------------------------------------------------------------------------
-- Another alliance's plan: refused before its version can answer.

select set_config('request.jwt.claims', '{}', true);
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own)
values ('00000000-0000-4000-8000-0000003290a2', 580, 'ext-329-other', 'Elsewhere', false);
insert into public.hive_formations
  (formation_id, name, server_id, anchor_x, anchor_y, alliance_id)
values ('00000000-0000-4000-8000-0000003290d9', 'Theirs', 580, 650, 650,
        '00000000-0000-4000-8000-0000003290a2');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000003290c3');
select throws_ok(
  $$ select public.save_hive_formation('00000000-0000-4000-8000-0000003290d9', 1, '[]', '[]') $$,
  '42501', null,
  'another alliance''s plan is refused even with its right version');
reset role;

select * from finish();
rollback;
