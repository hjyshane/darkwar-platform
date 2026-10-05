-- 0237: vehicle and pet-breakthrough steps are kinds; pets carry a rarity.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('vehicle', '0', 2, '[{"type":"item","id":"200034","amount":105}]') $$,
  'the vehicle level is a kind');
select lives_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, costs)
     values ('pet_break', '4', 10, '[{"type":"item","id":"330002","amount":40}]') $$,
  'a pet breakthrough is a kind');
select throws_ok(
  $$ update public.pets set rarity = 5 where false; insert into public.pets (pet_id, rarity) values (999901, 5) $$,
  '23514', null, 'a rarity is 1 to 4');
select has_column('public', 'account_state_latest', 'pets', 'the latest state carries pets');

select * from finish();
rollback;
