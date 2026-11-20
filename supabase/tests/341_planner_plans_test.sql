-- 0341: saved planner plans. The author writes, reads, renames and deletes
-- their own; another member neither reads, changes nor deletes them, and
-- cannot write one in somebody else's name; anon has nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000003410101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p341-author@test.invalid'),
  ('00000000-0000-4000-8000-000003410102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p341-other@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-000003410101', 'member', 'author'),
  ('00000000-0000-4000-8000-000003410102', 'member', 'other')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;

-- 1-3. The author saves a plan; it is theirs without saying so, and reads back.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000003410101')::text, true);
select lives_ok(
  $$ insert into public.planner_plans (plan_id, name, account_name, targets, extra_buffs)
     values ('00000000-0000-4000-8000-000003410001', 'HQ 31', 'author char',
             '[{"kind":"building","subject":"400000","name":"Headquarters","from":30,"to":31}]',
             '{"constructionSpeed":10,"researchSpeed":0,"costReduction":0}') $$,
  'the author saves a plan');
select is((select user_id from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'),
  '00000000-0000-4000-8000-000003410101'::uuid,
  'it is stamped with its author');
select is((select targets -> 0 ->> 'to' from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'), '31',
  'and reads back');

-- 4. The author renames it.
update public.planner_plans set name = 'HQ 31, then the lab'
  where plan_id = '00000000-0000-4000-8000-000003410001';
select is((select name from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'),
  'HQ 31, then the lab', 'the author renames it');

-- 5-6. Shapes are checked.
select throws_ok(
  $$ insert into public.planner_plans (name, targets) values ('bad', '{}') $$,
  '23514', null, 'targets must be a list');
select throws_ok(
  $$ insert into public.planner_plans (name) values ('   ') $$,
  '23514', null, 'a plan needs a name');

-- 7. Nobody saves a plan in another member's name.
select throws_ok(
  $$ insert into public.planner_plans (user_id, name)
     values ('00000000-0000-4000-8000-000003410102', 'planted') $$,
  '42501', null, 'the author cannot write a plan as somebody else');

-- 8-10. Another member neither reads, renames nor deletes it.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000003410102')::text, true);
select is((select count(*)::int from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'), 0,
  'another member does not read it');
update public.planner_plans set name = 'taken'
  where plan_id = '00000000-0000-4000-8000-000003410001';
delete from public.planner_plans
  where plan_id = '00000000-0000-4000-8000-000003410001';
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000003410101')::text, true);
select is((select count(*)::int from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'), 1,
  'nor deletes it');
select is((select name from public.planner_plans
            where plan_id = '00000000-0000-4000-8000-000003410001'),
  'HQ 31, then the lab', 'nor renames it');
reset role;

-- 11-12. Anon has nothing; authenticated cannot truncate.
select ok(not has_table_privilege('anon', 'public.planner_plans', 'select'),
  'anon has no read');
select ok(not has_table_privilege('authenticated', 'public.planner_plans', 'truncate'),
  'authenticated cannot truncate');

select * from finish();
rollback;
