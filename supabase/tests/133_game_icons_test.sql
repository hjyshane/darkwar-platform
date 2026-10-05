-- 0232: game art is for members. A member reads icons and refs; a viewer
-- (signed in, not a member) and anon read nothing; nobody but the service
-- writes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.game_icons (icon_key, image, width, height)
values ('hero_halfbody_Rider', 'UklGRg==', 96, 96);
insert into public.game_icon_refs (kind, ref_id, icon_key)
values ('hero', '40006', 'hero_halfbody_Rider');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000d1101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd1-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000d1102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd1-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000d1101', 'member', 'member'),
  ('00000000-0000-4000-8000-0000000d1102', 'viewer', 'viewer')
on conflict (user_id) do update set role = excluded.role;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d1101')::text, true);
select is((select i.image from public.game_icon_refs r
             join public.game_icons i using (icon_key)
            where r.kind = 'hero' and r.ref_id = '40006'), 'UklGRg==',
  'a member reads a hero''s icon');
select throws_ok(
  $$ insert into public.game_icons (icon_key, image, width, height) values ('x', 'x', 1, 1) $$,
  '42501', null, 'a member cannot write icons');

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000d1102')::text, true);
select is((select count(*)::int from public.game_icons), 0, 'a viewer reads no icons');
select is((select count(*)::int from public.game_icon_refs), 0, 'nor which icon is whose');
reset role;

select ok(not has_table_privilege('anon', 'public.game_icons', 'select'), 'anon reads no icons');
select ok(not has_table_privilege('authenticated', 'public.game_icons', 'truncate'),
  'authenticated cannot truncate icons');

-- 0233: resources and the rank glyphs are kinds too.
select lives_ok(
  $$ insert into public.game_icon_refs (kind, ref_id, icon_key)
     values ('resource', '25', 'UIRes_icon_wood'), ('ui', 'star_full', 'hero_star_icon') $$,
  'resource and ui icons are kinds');

select * from finish();
rollback;
