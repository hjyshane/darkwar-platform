-- 0351: event_names.category takes a key an admin made, in the slug shape, and
-- still refuses anything else; filing stays an officer's or an admin's.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0351', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cal-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0351', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cal-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000a0351', 'officer', 'cal officer'),
  ('00000000-0000-4000-8000-0000000b0351', 'member', 'cal member');

-- 1. Refusal first: a member files nothing, new category or old.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000b0351')::text, true);
set local role authenticated;
select throws_ok(
  $$insert into public.event_names (activity_id, name, category)
    values ('9351001', 'Member try', 'c-guild-war')$$,
  '42501', null,
  'a member cannot file an event');
reset role;

-- 2-3. An officer files into a built-in and into an added category.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000a0351')::text, true);
set local role authenticated;
select lives_ok(
  $$insert into public.event_names (activity_id, name, category)
    values ('9351002', 'Built in', 'major')$$,
  'an officer files into a built-in category');
select lives_ok(
  $$insert into public.event_names (activity_id, name, category)
    values ('9351003', 'Guild war', 'c-guild-war')$$,
  'an officer files into a category an admin added');
reset role;

-- 4-5. The shape is still enforced.
select throws_ok(
  $$insert into public.event_names (activity_id, name, category)
    values ('9351004', 'Bad', 'Guild War!')$$,
  '23514', null,
  'a key that is not a lowercase slug is refused');
select is(
  (select category from public.event_names where activity_id = '9351003'),
  'c-guild-war',
  'the added category is stored as written');

select * from finish();
rollback;
