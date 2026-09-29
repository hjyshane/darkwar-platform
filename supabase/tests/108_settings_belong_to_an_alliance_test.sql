-- 0200: every setting but the catalogue follows the alliance on screen — the
-- permission grid, the display keys, and the Discord delivery log.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000b8001', 580, 'ext-sp-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000b8002', 581, 'ext-sp-b', 'Bravo', 'BBB');

delete from public.app_settings
 where key in ('own_alliance', 'member_formulas', 'overview_metrics',
               'table_layout', 'season_building_alert');
insert into public.app_settings (key, value)
values ('member_formulas', '{"formulas": [{"id": "alpha"}]}'),
       ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000b8001"]}');

-- Pin Bravo as well: it gets a copy of Alpha's settings and grid.
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000b8001",
                               "00000000-0000-4000-8000-0000000b8002"]}'
where key = 'own_alliance';

-- 1-2. Display settings: a copy of what the primary has, '{}' for what it never saved.
select is(
  public.alliance_setting('member_formulas', '00000000-0000-4000-8000-0000000b8002'),
  '{"formulas": [{"id": "alpha"}]}'::jsonb,
  'a newly pinned alliance starts with the primary''s member columns');
select is(
  (select value from public.alliance_settings
    where alliance_id = '00000000-0000-4000-8000-0000000b8002' and key = 'overview_metrics'),
  '{}'::jsonb,
  'and an empty override where the primary has none, so it does not follow the primary later');

-- 3. The grid: each pinned alliance has rows of its own.
select is(
  (select count(distinct alliance_id)::int from public.role_permissions
    where capability = 'members.manage' and role = 'officer'
      and alliance_id in ('00000000-0000-4000-8000-0000000b8001',
                          '00000000-0000-4000-8000-0000000b8002')),
  2, 'both alliances hold their own permission rows');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000b8101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sp-off-b@test.invalid'),
  ('00000000-0000-4000-8000-0000000b8102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sp-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000b8101', 'viewer', 'sp off b'),
  ('00000000-0000-4000-8000-0000000b8102', 'admin', 'sp admin');
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8002', 'officer'),
  -- An officer in both, so the header decides which grid applies.
  ('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8001', 'officer');

-- Bravo's officers may manage members and settings; Alpha's may not.
update public.role_permissions set allowed = true
 where role = 'officer' and capability in ('members.manage', 'settings.write')
   and alliance_id = '00000000-0000-4000-8000-0000000b8002';
update public.role_permissions set allowed = false
 where role = 'officer' and capability in ('members.manage', 'settings.write')
   and alliance_id is distinct from '00000000-0000-4000-8000-0000000b8002';

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8002');

-- 4. has_permission reads the alliance on screen's grid.
select ok(public.has_permission('settings.write'),
  'Bravo''s officer holds settings.write in Bravo');

-- 5. They see their own grid and the defaults, never Alpha's.
select is(
  (select count(*)::int from public.role_permissions
    where alliance_id = '00000000-0000-4000-8000-0000000b8001'),
  0, 'Bravo''s officer cannot read Alpha''s grid');

-- 6-7. They edit Bravo's grid; Alpha's is untouched.
update public.role_permissions set allowed = true
 where role = 'member' and capability = 'settings.write';
reset role;
select is(
  (select allowed from public.role_permissions
    where role = 'member' and capability = 'settings.write'
      and alliance_id = '00000000-0000-4000-8000-0000000b8002'),
  true, 'an officer edits their own alliance''s grid');
select is(
  (select bool_or(allowed) from public.role_permissions
    where role = 'member' and capability = 'settings.write'
      and (alliance_id = '00000000-0000-4000-8000-0000000b8001' or alliance_id is null)),
  false, 'and neither Alpha''s grid nor the defaults move');

-- 8. The shared row is not theirs to write, settings.write or not.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8002');
select throws_ok(
  $$ insert into public.app_settings (key, value) values ('sp_probe', '{}') $$,
  '42501', null,
  'an officer of a non-primary alliance cannot write app_settings directly');

-- 9-10. They save a display setting for Bravo, and Alpha does not see it.
select lives_ok(
  $$ select public.save_alliance_setting('overview_metrics', '{"tiles": ["bravo"]}') $$,
  'Bravo saves its overview figures');
reset role;
select is(
  public.alliance_setting('overview_metrics', '00000000-0000-4000-8000-0000000b8001'),
  null, 'Alpha still has none');
select is(
  public.alliance_setting('overview_metrics', '00000000-0000-4000-8000-0000000b8002'),
  '{"tiles": ["bravo"]}'::jsonb, 'Bravo has its own');

-- 11. Viewing Alpha, the same officer holds Alpha's grid: no settings.write.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8001');
select ok(not public.has_permission('settings.write'),
  'the header cannot borrow Bravo''s grid for Alpha');
reset role;

-- 12. A capability added later reaches every pinned alliance.
insert into public.capabilities (capability, label) values ('sp.probe', 'probe');
insert into public.role_permissions (role, capability, allowed)
values ('officer', 'sp.probe', true);
select is(
  (select count(*)::int from public.role_permissions
    where capability = 'sp.probe'
      and alliance_id in ('00000000-0000-4000-8000-0000000b8001',
                          '00000000-0000-4000-8000-0000000b8002')),
  2, 'a new default is copied to every pinned alliance');

-- 13-14. The delivery log: an admin viewing Bravo sees Bravo's deliveries.
insert into public.notification_channels (channel, webhook_url, alliance_id)
values
  ('sp-a', 'https://discord.invalid/a', '00000000-0000-4000-8000-0000000b8001'),
  ('sp-b', 'https://discord.invalid/b', '00000000-0000-4000-8000-0000000b8002');
insert into public.notification_outbox (channel, event, idempotency_key, title, body)
values ('sp-a', 'test', 'sp:a', 'sp to a', ''),
       ('sp-b', 'test', 'sp:b', 'sp to b', '');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8102', '00000000-0000-4000-8000-0000000b8002');
select is(
  (select array_agg(title order by title) from public.notification_outbox where title like 'sp %'),
  array['sp to b'], 'an admin viewing Bravo sees Bravo''s deliveries');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8102', '00000000-0000-4000-8000-0000000b8001');
select is(
  (select array_agg(title order by title) from public.notification_outbox where title like 'sp %'),
  array['sp to a'], 'and viewing Alpha, Alpha''s');

-- 15. An admin may still write the shared row from anywhere (the pin list).
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8102', '00000000-0000-4000-8000-0000000b8002');
select lives_ok(
  $$ insert into public.app_settings (key, value) values ('sp_probe', '{}') $$,
  'an admin writes app_settings whichever alliance is on screen');
reset role;

-- 16. The pin list is an admin's, even for an officer of the primary who
-- holds settings.write there.
update public.role_permissions set allowed = true
 where role = 'officer' and capability = 'settings.write'
   and alliance_id = '00000000-0000-4000-8000-0000000b8001';
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b8101', '00000000-0000-4000-8000-0000000b8001');
update public.app_settings set value = '{"alliance_ids": []}' where key = 'own_alliance';
reset role;
select is(
  (select jsonb_array_length(value -> 'alliance_ids') from public.app_settings
    where key = 'own_alliance'),
  2, 'an officer of the primary cannot rewrite the pin list');

-- 17. anon reads the defaults only.
set local role anon;
select is(
  (select count(*)::int from public.role_permissions where alliance_id is not null),
  0, 'anon sees no alliance''s grid');
reset role;

select * from finish();
rollback;
