-- 0229: hero rarity is member-readable and not member-writable; the material
-- list names each material once with the kinds that use it; anon reads
-- neither.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.game_hero_rarity (hero_id, rarity) values (40015, 1);
insert into public.game_upgrade_steps (kind, subject_id, level, costs) values
  ('building', '999100', 2, '[{"type": "resource", "id": "25", "amount": 10},
                              {"type": "item", "id": "253042", "amount": 3}]'),
  ('research', '999101', 1, '[{"type": "resource", "id": "25", "amount": 5}]');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000f0101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f0-member@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000f0101', 'member', 'member')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000f0101')::text, true);

select is((select rarity::int from public.game_hero_rarity where hero_id = 40015), 1,
  'a member reads hero rarity');
select throws_ok(
  $$ insert into public.game_hero_rarity (hero_id, rarity) values (1, 1) $$,
  '42501', null, 'a member cannot write hero rarity');
select is(
  (select kinds from public.game_upgrade_materials where type = 'resource' and id = '25'),
  array['building', 'research'],
  'a material is listed once, with every kind that costs it');
reset role;

select ok(not has_table_privilege('anon', 'public.game_hero_rarity', 'select'),
  'anon reads no rarity');
select ok(not has_table_privilege('anon', 'public.game_upgrade_materials', 'select'),
  'anon reads no material list');

select * from finish();
rollback;
