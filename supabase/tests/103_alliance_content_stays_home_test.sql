-- 0194: an alliance's notices, schedule, hive plans and join codes are seen
-- and written only while that alliance is the one being viewed.
--
-- Every assertion about "cannot see" is paired with one about "can see" in
-- the same setup, because a restrictive policy that hid everything would
-- pass all the negatives on its own (§20.2 wants the negative; this file
-- wants to know the negative means something).
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Fixtures ------------------------------------------------------------------

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000d1001', 580, 'ext-ch-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000d1002', 581, 'ext-ch-b', 'Bravo', 'BBB');

delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000d1001",
                                           "00000000-0000-4000-8000-0000000d1002"]}');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ch-a@test.invalid'),
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ch-b@test.invalid'),
  ('00000000-0000-4000-8000-0000000d2003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ch-admin@test.invalid');

insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000d2001', 'member'),  -- mirror: Alpha
  ('00000000-0000-4000-8000-0000000d2002', 'viewer'),
  ('00000000-0000-4000-8000-0000000d2003', 'admin');
insert into public.alliance_memberships (user_id, alliance_id, role)
values ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d1002', 'member');

-- Published, public-to-members notices, one per alliance. Written as the
-- owner, so the restrictive policy is not what places them.
insert into public.announcements (announcement_id, title, body, alliance_id, published_at)
values
  ('00000000-0000-4000-8000-0000000d3001', 'ch alpha notice', '',
   '00000000-0000-4000-8000-0000000d1001', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000d3002', 'ch bravo notice', '',
   '00000000-0000-4000-8000-0000000d1002', now() - interval '1 hour');

insert into public.hive_formations (formation_id, name, server_id, anchor_x, anchor_y, alliance_id, is_active)
values
  ('00000000-0000-4000-8000-0000000d4001', 'ch alpha plan', 580, 500, 500,
   '00000000-0000-4000-8000-0000000d1001', true),
  ('00000000-0000-4000-8000-0000000d4002', 'ch bravo plan', 580, 500, 500,
   '00000000-0000-4000-8000-0000000d1002', false);

insert into public.hive_formation_slots (formation_id, dx, dy)
values ('00000000-0000-4000-8000-0000000d4002', 0, 0);

insert into public.join_codes (code, alliance_id)
values ('CH-ALPHA', '00000000-0000-4000-8000-0000000d1001'),
       ('CH-BRAVO', '00000000-0000-4000-8000-0000000d1002');

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

set local role authenticated;

-- Reading -------------------------------------------------------------------

-- 1-3. A member of Alpha sees Alpha's notice, not Bravo's, header or not.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2001', null);
select is((select count(*)::int from public.announcements where title = 'ch alpha notice'), 1,
  'a member of Alpha reads Alpha''s notice');
select is((select count(*)::int from public.announcements where title = 'ch bravo notice'), 0,
  'and not Bravo''s');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d1002');
select is((select count(*)::int from public.announcements where title = 'ch bravo notice'), 0,
  'asking for Bravo by header changes nothing');

-- 4-5. And the other way round.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2002', null);
select is((select count(*)::int from public.announcements where title = 'ch bravo notice'), 1,
  'a member of Bravo reads Bravo''s notice');
select is((select count(*)::int from public.announcements where title = 'ch alpha notice'), 0,
  'and not Alpha''s');

-- 6-7. An admin sees one alliance at a time, the one being viewed.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1002');
select is(
  (select array_agg(title order by title) from public.announcements where title like 'ch %'),
  array['ch bravo notice'],
  'an admin viewing Bravo sees Bravo''s board');
select is(
  (select array_agg(code order by code) from public.join_codes where code like 'CH-%'),
  array['CH-BRAVO'],
  'and Bravo''s join codes');

-- 8. Children follow their parent.
select is((select count(*)::int from public.hive_formation_slots
            where formation_id = '00000000-0000-4000-8000-0000000d4002'), 1,
  'an admin viewing Bravo sees Bravo''s hive slots');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2001', null);
select is((select count(*)::int from public.hive_formation_slots
            where formation_id = '00000000-0000-4000-8000-0000000d4002'), 0,
  'a member of Alpha does not');

-- Writing -------------------------------------------------------------------

-- 10-11. A new row lands in the alliance being viewed; another's is refused.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1002');
insert into public.announcements (title, body) values ('ch admin wrote in bravo', '');
reset role;
select is(
  (select alliance_id from public.announcements where title = 'ch admin wrote in bravo'),
  '00000000-0000-4000-8000-0000000d1002'::uuid,
  'a notice written while viewing Bravo belongs to Bravo');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1002');
select throws_ok(
  $$ insert into public.announcements (title, body, alliance_id)
     values ('ch smuggled', '', '00000000-0000-4000-8000-0000000d1001') $$,
  '42501', null,
  'naming another alliance on insert is refused');

-- 12. An update cannot reach the other alliance's row at all.
update public.announcements set title = 'ch defaced' where title = 'ch alpha notice';
reset role;
select is((select count(*)::int from public.announcements where title = 'ch alpha notice'), 1,
  'an update aimed at Alpha while viewing Bravo touches nothing');
set local role authenticated;

-- 13. THE DEFINER DOOR: save_hive_formation_layout runs as its owner, so RLS
-- does not see it. The guard trigger does.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1002');
select throws_ok(
  $$ select public.save_hive_formation_layout('00000000-0000-4000-8000-0000000d4001',
                                              '[{"dx": 3, "dy": 3}]') $$,
  '42501', null,
  'a definer RPC cannot draw on another alliance''s formation');

-- 14. And the same RPC still works at home.
select lives_ok(
  $$ select public.save_hive_formation_layout('00000000-0000-4000-8000-0000000d4002',
                                              '[{"dx": 0, "dy": 0}, {"dx": 6, "dy": 0}]') $$,
  'while drawing on its own alliance''s formation works');

-- 15. Deleting a formation cascades to its slots after the parent is gone;
-- the slot guard must not read that as "another alliance".
select lives_ok(
  $$ delete from public.hive_formations
      where formation_id = '00000000-0000-4000-8000-0000000d4002' $$,
  'deleting a non-primary alliance''s formation, slots and all, works');

-- Uniqueness per alliance ---------------------------------------------------

-- Claims set with is_local survive `reset role` for the rest of the
-- transaction, so without this the owner inserts below would still count as
-- "the admin, viewing Bravo" and the guard trigger would refuse Alpha's.
reset role;
select set_config('request.jwt.claims', '{}', true),
       set_config('request.headers', '{}', true);

-- 16. Both alliances may have a live plan on the same server.
select lives_ok(
  $$ insert into public.hive_formations (name, server_id, anchor_x, anchor_y, alliance_id, is_active)
     values ('ch bravo live', 580, 400, 400, '00000000-0000-4000-8000-0000000d1002', true) $$,
  'one live formation per server PER ALLIANCE, not per install');

-- 17. But still only one each.
select throws_ok(
  $$ insert into public.hive_formations (name, server_id, anchor_x, anchor_y, alliance_id, is_active)
     values ('ch alpha second', 580, 300, 300, '00000000-0000-4000-8000-0000000d1001', true) $$,
  '23505', null,
  'and still only one per alliance');

-- 18. Template names are per alliance too.
insert into public.hive_formation_templates (name, alliance_id)
values ('ch shape', '00000000-0000-4000-8000-0000000d1001');
select lives_ok(
  $$ insert into public.hive_formation_templates (name, alliance_id)
     values ('CH Shape ', '00000000-0000-4000-8000-0000000d1002') $$,
  'the same template name may exist in each alliance');

select * from finish();
rollback;
