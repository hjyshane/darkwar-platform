-- 0193: a role belongs to an alliance, the header only chooses among
-- alliances you are in, and an account can be several players.
--
-- Two own alliances are pinned here, which production must not do until
-- phase 5; the rollback keeps that inside this file.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Fixtures ------------------------------------------------------------------

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000c1001', 580, 'ext-ra-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000c1002', 581, 'ext-ra-b', 'Bravo', 'BBB'),
  ('00000000-0000-4000-8000-0000000c1003', 582, 'ext-ra-c', 'Charlie', 'CCC');

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c3001', 580, 58019001, 'BothMain'),
  ('00000000-0000-4000-8000-0000000c3002', 581, 58019002, 'BothAlt'),
  ('00000000-0000-4000-8000-0000000c3003', 580, 58019003, 'Stranger');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-legacy@test.invalid', null),
  ('00000000-0000-4000-8000-0000000c2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-a@test.invalid', null),
  ('00000000-0000-4000-8000-0000000c2003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-b-officer@test.invalid', null),
  ('00000000-0000-4000-8000-0000000c2004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-both@test.invalid', null),
  ('00000000-0000-4000-8000-0000000c2005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-admin@test.invalid', null),
  ('00000000-0000-4000-8000-0000000c2006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-new@test.invalid',
   '{"alliance_id": "00000000-0000-4000-8000-0000000c1002"}'),
  ('00000000-0000-4000-8000-0000000c2007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ra-waiting-a@test.invalid',
   '{"alliance_id": "00000000-0000-4000-8000-0000000c1001"}');

-- A legacy member made while nothing is pinned: no membership anywhere.
delete from public.app_settings where key = 'own_alliance';
insert into public.app_users (user_id, role)
values ('00000000-0000-4000-8000-0000000c2001', 'member');

-- Pin both. Alpha is primary.
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000c1001",
                                           "00000000-0000-4000-8000-0000000c1002"]}');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000c2002', 'member'),   -- mirror: member of Alpha
  ('00000000-0000-4000-8000-0000000c2003', 'viewer'),
  ('00000000-0000-4000-8000-0000000c2004', 'member'),   -- mirror: member of Alpha
  ('00000000-0000-4000-8000-0000000c2005', 'admin');
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c1002', 'officer'),
  ('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1002', 'officer');

update public.role_permissions set allowed = true
where role = 'officer' and capability = 'members.manage';

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

-- Roles ---------------------------------------------------------------------

set local role authenticated;

-- 1. The compatibility line.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2001', null);
select is(public.current_app_role()::text, 'member',
  'an account with no memberships keeps its app_users role');

-- 2-3. Member of Alpha only; a header naming Bravo is ignored, not obeyed.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2002', null);
select is(public.current_app_role()::text, 'member', 'member of Alpha is a member without a header');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c1002');
select is(public.active_alliance(), '00000000-0000-4000-8000-0000000c1001'::uuid,
  'a header naming an alliance you are not in is ignored');

-- 4-5. Officer of Bravo only: Bravo is where they land, Alpha header ignored.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2003', null);
select is(public.current_app_role()::text, 'officer', 'officer of Bravo lands in Bravo');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c1001');
select is(public.current_app_role()::text, 'officer',
  'and cannot become a viewer-with-a-view of Alpha by asking');

-- 6-8. In both: the header switches, and the role follows it.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1001');
select is(public.current_app_role()::text, 'member', 'in both, viewing Alpha: member');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1002');
select is(public.current_app_role()::text, 'officer', 'in both, viewing Bravo: officer');
select is((select count(*)::int from public.my_alliances()), 2,
  'the switcher offers both');

-- 9-10. Admin: global role, any own alliance, but not a foreign one.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2005', '00000000-0000-4000-8000-0000000c1002');
select is(public.active_alliance(), '00000000-0000-4000-8000-0000000c1002'::uuid,
  'an admin may view any own alliance');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2005', '00000000-0000-4000-8000-0000000c1003');
select is(public.active_alliance(), '00000000-0000-4000-8000-0000000c1001'::uuid,
  'but not an alliance that is not ours');

-- Membership writes ---------------------------------------------------------

-- 11-13. An officer manages the alliance they view, and only that one.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c1002');
select lives_ok(
  $$ select public.set_membership('00000000-0000-4000-8000-0000000c2002',
                                  '00000000-0000-4000-8000-0000000c1002', 'member') $$,
  'an officer of Bravo may admit somebody to Bravo');
select throws_ok(
  $$ select public.set_membership('00000000-0000-4000-8000-0000000c2002',
                                  '00000000-0000-4000-8000-0000000c1001', 'officer') $$,
  '42501', null,
  'but may not touch Alpha');
select throws_ok(
  $$ select public.set_membership('00000000-0000-4000-8000-0000000c2002',
                                  '00000000-0000-4000-8000-0000000c1002', 'admin') $$,
  '22023', null,
  'and may not hand out admin');
select throws_ok(
  $$ select public.set_membership('00000000-0000-4000-8000-0000000c2005',
                                  '00000000-0000-4000-8000-0000000c1002', 'member') $$,
  '22023', null,
  'nor write a membership onto an admin, whose role is global');

-- 14. A plain member cannot manage at all.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c1001');
select throws_ok(
  $$ select public.set_membership('00000000-0000-4000-8000-0000000c2003',
                                  '00000000-0000-4000-8000-0000000c1001', 'member') $$,
  '42501', null,
  'a member cannot write memberships');

-- 15. Revoking in the primary goes through app_users.role and the mirror.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2005', null);
select public.set_membership('00000000-0000-4000-8000-0000000c2002',
                             '00000000-0000-4000-8000-0000000c1001', null);
reset role;
select is(
  (select array_agg(alliance_id::text) from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000c2002'),
  array['00000000-0000-4000-8000-0000000c1002'],
  'revoking Alpha leaves Bravo');
set local role authenticated;

-- Join codes ----------------------------------------------------------------

reset role;
insert into public.join_codes (code, grants_role, alliance_id)
values ('RA-BRAVO-CODE', 'member', '00000000-0000-4000-8000-0000000c1002');
set local role authenticated;

-- 16-18. A code admits you to ITS alliance, not the primary.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2006', null);
select is(public.redeem_join_code('RA-BRAVO-CODE')::text, 'member', 'a Bravo code redeems');
reset role;
select is(
  (select alliance_id from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000c2006'),
  '00000000-0000-4000-8000-0000000c1002'::uuid,
  'and the membership is in Bravo');
select is(
  (select count(*)::int from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000c2006'
      and alliance_id = '00000000-0000-4000-8000-0000000c1001'),
  0,
  'not in Alpha');
set local role authenticated;

-- 19. Redeeming again for an alliance you are in burns nothing.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2006', null);
select public.redeem_join_code('RA-BRAVO-CODE');
reset role;
select is((select used_count from public.join_codes where code = 'RA-BRAVO-CODE'), 1,
  'a second redemption into the same alliance does not burn a use');
set local role authenticated;

-- Players -------------------------------------------------------------------

-- 20-23. Two players on one account; the first is the display player.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1001');
select public.claim_player('00000000-0000-4000-8000-0000000c3001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1002');
select public.claim_player('00000000-0000-4000-8000-0000000c3002');
select is((select count(*)::int from public.linked_player_ids()), 2,
  'one account, two players');
select is(public.linked_player_id(), '00000000-0000-4000-8000-0000000c3001'::uuid,
  'the first claimed is the display player');

select pg_temp.as_user('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c1002');
select throws_ok(
  $$ select public.claim_player('00000000-0000-4000-8000-0000000c3002') $$,
  '23505', null,
  'a player another account holds cannot be claimed');
select is(
  (select count(*)::int from public.user_players
    where user_id = '00000000-0000-4000-8000-0000000c2004'),
  0,
  'nor can another account''s players be read');

-- 24. Unlinking the display player promotes the other.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2004', null);
select public.unlink_player('00000000-0000-4000-8000-0000000c3001');
select is(public.linked_player_id(), '00000000-0000-4000-8000-0000000c3002'::uuid,
  'unlinking the display player shows the account as its other player');

-- 25. The admin screen moving app_users.player_id still moves the link.
reset role;
update public.app_users set player_id = '00000000-0000-4000-8000-0000000c3003'
where user_id = '00000000-0000-4000-8000-0000000c2004';
select is(
  (select array_agg(player_id::text order by player_id) from public.user_players
    where user_id = '00000000-0000-4000-8000-0000000c2004'),
  array['00000000-0000-4000-8000-0000000c3003'],
  'moving the display player replaces that link');
set local role authenticated;

-- The door ------------------------------------------------------------------

-- 26-28. An officer sees who is waiting for THEIR alliance; admin sees all.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c1002');
select is(
  (select count(*)::int from public.pending_access
    where user_id = '00000000-0000-4000-8000-0000000c2007'),
  0,
  'an officer of Bravo does not see somebody waiting for Alpha');

select pg_temp.as_user('00000000-0000-4000-8000-0000000c2005', '00000000-0000-4000-8000-0000000c1002');
select is(
  (select requested_alliance_id from public.pending_access
    where user_id = '00000000-0000-4000-8000-0000000c2007'),
  '00000000-0000-4000-8000-0000000c1001'::uuid,
  'an admin sees them, with the alliance they asked for');

select pg_temp.as_user('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c1002');
select is(
  (select count(*)::int from public.pending_access),
  0,
  'a member without members.manage sees nobody waiting');

-- A stranded membership ------------------------------------------------------

-- 30-31. A re-pin leaves memberships behind in an alliance that is no longer
-- ours (the mirror put them wherever was primary at the time). Such a row
-- must neither become the alliance on screen nor switch off the legacy role.
reset role;
insert into public.alliance_memberships (user_id, alliance_id, role)
values ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-4000-8000-0000000c1003', 'member');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000c2001', null);
select is(public.active_alliance(), '00000000-0000-4000-8000-0000000c1001'::uuid,
  'a membership of an alliance no longer ours is not where the account lands');
select is(public.current_app_role()::text, 'member',
  'and it does not turn the legacy member into a viewer');

reset role;
select * from finish();
rollback;
