-- 0217: hero levels are a kind of upgrade step.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('hero', 'hero', 21, '[{"type": "resource", "id": "24", "amount": 45000}]') $$,
  'a hero level is a step');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level) values ('gear', 'x', 1) $$,
  '23514', null, 'an unknown kind is still refused');

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('hero_gear', 'promote', 11, '[]') $$,
  'a hero gear step is a step (0218)');

select * from finish();
rollback;
