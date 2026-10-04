-- 0220: steps carry their prerequisites; hero gear is member-readable.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.game_upgrade_steps (kind, subject_id, level, costs, requires)
values ('building', '400000', 31,
        '[{"type": "item", "id": "253042", "amount": 180}]',
        '[{"subject": "402000", "level": 30}, {"subject": "424000", "level": 30}]');
insert into public.game_hero_gear (equip_id, name, quality, slot) values (410100, 'D5-Slayer', 5, 1);

select is((select jsonb_array_length(requires) from public.game_upgrade_steps
            where kind = 'building' and subject_id = '400000' and level = 31), 2,
  'a building step carries the buildings it needs');
select throws_ok(
  $$ insert into public.game_upgrade_steps (kind, subject_id, level, requires)
     values ('building', '1', 1, '{"not": "a list"}') $$,
  '23514', null, 'requires must be a list');
insert into public.game_upgrade_steps (kind, subject_id, level) values ('hero', 'hero', 2);
select is((select requires from public.game_upgrade_steps
            where kind = 'hero' and subject_id = 'hero' and level = 2), '[]'::jsonb,
  'a step written without requirements has none');
select ok(not has_table_privilege('anon', 'public.game_hero_gear', 'select'),
  'anon has no read on hero gear');

select * from finish();
rollback;
