-- 0347: every change to a settings row leaves a row in settings_history, only
-- an admin reads it, and only an admin changes the server group.
--
-- The refusals go first: a history table that a member could read would hand
-- them who changed every permission and when.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0347', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'history-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0347', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'history-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000a0347', 'admin', 'history admin'),
  ('00000000-0000-4000-8000-0000000b0347', 'member', 'history member');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers', '{}', true);
$$;

-- A change made as the admin, through the table the form writes.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000a0347');
insert into public.app_settings (key, value) values ('history_test_rate', '0.0099');
update public.app_settings set value = '0.012' where key = 'history_test_rate';
-- Saving the same value again is not a change.
update public.app_settings set value = '0.012' where key = 'history_test_rate';
delete from public.app_settings where key = 'history_test_rate';
reset role;

-- 1-2. Refusals first.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b0347');
select is(
  (select count(*) from public.settings_history where item = 'history_test_rate'),
  0::bigint,
  'a member reads no settings history');
reset role;

set local role anon;
select throws_ok(
  'select count(*) from public.settings_history',
  '42501',
  null,
  'anon cannot read settings history at all');
reset role;

-- 3-7. What the admin's three changes left behind.
select is(
  (select count(*) from public.settings_history
    where source = 'app_settings' and item = 'history_test_rate'),
  3::bigint,
  'insert, update and delete each leave one row; the unchanged save leaves none');
select is(
  (select array[old_value, new_value] from public.settings_history
    where item = 'history_test_rate' and old_value is null),
  array[null, '0.0099'::jsonb],
  'an insert has the new value and no old one');
select is(
  (select array[old_value, new_value] from public.settings_history
    where item = 'history_test_rate' and old_value is not null and new_value is not null),
  array['0.0099'::jsonb, '0.012'::jsonb],
  'an update has both');
select is(
  (select count(*) from public.settings_history
    where item = 'history_test_rate' and new_value is null and old_value = '0.012'::jsonb),
  1::bigint,
  'a delete has the old value and no new one');
select is(
  (select array_agg(distinct changed_by) from public.settings_history
    where item = 'history_test_rate'),
  array['00000000-0000-4000-8000-0000000a0347'::uuid],
  'each row names the admin who made the change');

-- 8. The admin reads it.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000a0347');
select is(
  (select count(*) from public.settings_history where item = 'history_test_rate'),
  3::bigint,
  'an admin reads the history');
reset role;

-- 9. A table whose row is named by two columns. Written with no session: the
-- claims set above outlive `reset role` inside the transaction.
select set_config('request.jwt.claims', '{}', true);
insert into public.tab_visibility (tab_key, role, visible) values ('historyTab', 'member', false);
select is(
  (select array[item, new_value::text] from public.settings_history
    where source = 'tab_visibility' and item like 'historyTab:%'),
  array['historyTab:member', 'false'],
  'a tab hidden from members is recorded as tab:role');

-- 10. A change made by no signed-in person has no author.
select is(
  (select changed_by from public.settings_history
    where source = 'tab_visibility' and item = 'historyTab:member'),
  null::uuid,
  'a change outside a session (a migration, sync) has no author');

-- 11. Per-alliance settings carry their alliance.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values ('00000000-0000-4000-8000-0000000c0347', 580, 'ext-history', 'History', 'HIS');
insert into public.alliance_settings (alliance_id, key, value)
values ('00000000-0000-4000-8000-0000000c0347', 'table_layout', '{}');
select is(
  (select alliance_id from public.settings_history
    where source = 'alliance_settings' and item = 'table_layout'
      and alliance_id = '00000000-0000-4000-8000-0000000c0347'),
  '00000000-0000-4000-8000-0000000c0347'::uuid,
  'an alliance setting is recorded with its alliance');

-- 12-13. The server group: a member is refused, and nothing changes.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b0347');
select throws_ok(
  'select public.set_server_tracked(580, false)',
  '42501',
  null,
  'a member cannot change the server group');
reset role;
select is(
  (select is_tracked from public.servers where server_id = 580),
  true,
  'the refused call changed nothing');

-- 14-16. The admin takes a server out, and adds one nobody has captured.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000a0347');
select public.set_server_tracked(580, false);
select public.set_server_tracked(9347, true);
reset role;
select is(
  (select array[(select is_tracked from public.servers where server_id = 580),
                (select is_tracked from public.servers where server_id = 9347)]),
  array[false, true],
  'an admin takes a server out of the group and adds a new one to it');
select is(
  (select array[old_value::text, new_value::text, changed_by::text] from public.settings_history
    where source = 'servers' and item = '580'),
  array['true', 'false', '00000000-0000-4000-8000-0000000a0347'],
  'taking a server out is recorded with its author');
select is(
  (select array[coalesce(old_value::text, 'none'), new_value::text] from public.settings_history
    where source = 'servers' and item = '9347'),
  array['none', 'true'],
  'adding a server is recorded as an insert');

select * from finish();
rollback;
