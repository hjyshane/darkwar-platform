-- 0279: ui_overrides -- readable by members, written only by an admin through
-- the two functions, display text kept plain.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ui-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ui-officer@test.invalid'),
  ('00000000-0000-4000-8000-00000000e303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ui-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e301', 'member', 'ui member'),
  ('00000000-0000-4000-8000-00000000e302', 'officer', 'ui officer'),
  ('00000000-0000-4000-8000-00000000e303', 'admin', 'ui admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- ------------------------------------------------------------- who may write

select pg_temp.act_as('00000000-0000-4000-8000-00000000e301');
set local role authenticated;
select throws_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'label', 'Boss')$$,
  '42501', null, 'a member cannot rename a page');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e302');
set local role authenticated;
select throws_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'label', 'Boss')$$,
  '42501', null, 'an officer cannot either (admin only)');
select throws_ok(
  $$insert into public.ui_overrides (scope, key, kind, value) values ('x', 'y', 'label', 'z')$$,
  '42501', null, 'and nobody writes the table directly');

reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000e303');
set local role authenticated;

-- --------------------------------------------------------------- the admin

select lives_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'label', '  Boss fights  ')$$,
  'an admin renames a page');
select is((select value from public.ui_overrides
            where scope = 'events-hub' and key = 'frankie' and kind = 'label'),
  'Boss fights', 'the name is stored trimmed');
select lives_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'label', 'Frankie fights')$$,
  'renaming again replaces it');
select is((select count(*) from public.ui_overrides
            where scope = 'events-hub' and key = 'frankie'), 1::bigint,
  'one row per scope, key and kind');

select throws_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'label', '<b>x</b>')$$,
  '23514', null, 'a name with markup is refused');
select throws_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'order', 'first')$$,
  '23514', null, 'an order that is not a number is refused');
select throws_ok(
  $$select public.set_ui_override('events-hub', 'frankie', 'hidden', 'false')$$,
  '23514', null, 'hidden is only ever true (clear it to show again)');

-- ------------------------------------------------------------------- clear

select public.set_ui_override('events-hub', 'frankie', 'order', '2');
select is(public.clear_ui_override('events-hub', 'frankie', 'label'), 1,
  'clearing one kind removes that row');
select is(public.clear_ui_override('events-hub', 'frankie'), 1,
  'clearing with no kind removes what is left of the key');

select * from finish();
rollback;
