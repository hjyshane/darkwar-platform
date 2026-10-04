-- 0217: hero levels are a kind of upgrade step.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('hero', 'hero', 21, '[{"type": "resource", "id": "24", "amount": 45000}]') $$,
  'a hero level is a step');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level) values ('gear', 'x', 1) $$,
  '23514', null, 'an unknown kind is still refused');

select * from finish();
rollback;
