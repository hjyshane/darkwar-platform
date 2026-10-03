-- 0209: members read the game catalogue; nobody but the collector writes it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ca101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gc-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ca102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gc-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ca101', 'member', 'gc member'),
  ('00000000-0000-4000-8000-0000000ca102', 'viewer', 'gc viewer')
on conflict (user_id) do update set role = excluded.role;

set local role service_role;
-- 1. The collector writes all three.
select lives_ok(
  $$ insert into public.game_items (item_id, name, name_ko) values ('253042', 'Precision Part', '정밀 부품');
     insert into public.game_resources (resource_id, name) values (25, 'Wood');
     insert into public.game_upgrade_steps (kind, subject_id, level, name, costs, seconds, power)
     values ('vehicle_part', '1', 27, 'Gun',
             '[{"type": "item", "id": "200040", "amount": 540}]', null, 3092400) $$,
  'service_role writes the catalogue');
reset role;

-- 2. A step's kind must be one the planner knows.
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level) values ('spaceship', '1', 1) $$,
  '23514', null, 'an unknown upgrade kind is refused');
-- 3. Costs must be an array.
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs) values ('pet', '1', 1, '{}') $$,
  '23514', null, 'costs must be a json array');
-- 4. Item ids are numeric.
select throws_ok(
  $$ insert into public.game_items (item_id) values ('wood') $$,
  '23514', null, 'an item id must be numeric');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000ca101');
-- 5. A member reads them.
select is((select costs -> 0 ->> 'amount' from public.game_upgrade_steps
            where kind = 'vehicle_part' and subject_id = '1' and level = 27),
  '540', 'a member reads upgrade costs');
select is((select name_ko from public.game_items where item_id = '253042'),
  '정밀 부품', 'a member reads item names in both languages');
-- 7. A member cannot write.
select throws_ok(
  $$ insert into public.game_items (item_id, name) values ('1', 'forged') $$,
  '42501', null, 'a member cannot write the catalogue');

select pg_temp.as_user('00000000-0000-4000-8000-0000000ca102');
-- 8. A viewer reads nothing.
select is((select count(*) from public.game_upgrade_steps)::int, 0,
  'a viewer does not read the catalogue');
reset role;

-- 9. anon reads nothing and nobody else truncates.
select ok(not has_table_privilege('anon', 'public.game_items', 'select')
          and not has_table_privilege('authenticated', 'public.game_upgrade_steps', 'truncate'),
  'anon cannot read; authenticated cannot truncate');

select * from finish();
rollback;
