-- 0310: the event guide model — who reads a guide, who writes one, and the
-- importer's path.
--
-- Guides are shared game facts (no alliance), so every signed-in role that
-- reads game_event_scores reads them, community included (0283). Writing goes
-- through the 0078 guide.* capabilities, so the negatives worth pinning are
-- the two the spec names: community cannot write; a member without
-- guide.write cannot write. The importer runs as service_role and must be
-- able to create a guide and its client sections.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad309', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eg-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be309', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eg-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce309', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eg-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000de309', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eg-community@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad309', 'admin'),
  ('00000000-0000-4000-8000-0000000be309', 'member'),
  ('00000000-0000-4000-8000-0000000ce309', 'officer'),
  ('00000000-0000-4000-8000-0000000de309', 'community');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- An officer-typed guide with one officer section, as the owner.
insert into public.event_guides (activity_id, slug, title, published)
values ('100099', 'halloween-2026', 'Halloween', true);
insert into public.event_guide_sections (guide_id, kind, title, sort_order, source, payload)
select guide_id, 'notes', 'Notes', 1, 'officer', '{"text": "Trick or treat."}'
from public.event_guides where slug = 'halloween-2026';

-- ---------------------------------------------------------------- the importer
set local role service_role;
select lives_ok(
  $$ insert into public.event_guides (activity_id, slug, title)
     values ('100004', 'activity-100004', 'Survival Preparedness') $$,
  'the importer (service role) creates a guide');
select lives_ok(
  $$ insert into public.event_guide_sections (guide_id, kind, title, sort_order, source, payload)
     select guide_id, 'point_table', 'Training Day', 1, 'client',
            '{"day": null, "theme": "Training Day", "rows": []}'
     from public.event_guides where slug = 'activity-100004' $$,
  'and writes a client section under it');
select is(
  (select published from public.event_guides where slug = 'activity-100004'),
  false,
  'a guide the importer creates is unpublished until an officer looks at it');
reset role;

set local role authenticated;

-- ------------------------------------------------------------------ the member
select pg_temp.act_as('00000000-0000-4000-8000-0000000be309');
select is(
  (select count(*) from public.event_guides),
  2::bigint,
  'a member reads every guide, published or not — the picker hides drafts, not the policy');
select throws_ok(
  $$ insert into public.event_guides (slug, title) values ('mine', 'Mine') $$,
  '42501', NULL,
  'a member without guide.write cannot create a guide');
select throws_ok(
  $$ insert into public.event_guide_sections (guide_id, kind, payload)
     select guide_id, 'notes', '{"text": "x"}' from public.event_guides where slug = 'halloween-2026' $$,
  '42501', NULL,
  'nor add a section');
select throws_ok(
  $$ insert into public.game_event_score_items (score_id, item_ref)
     values ('1000020101', '{"kind": "item", "id": "253042"}') $$,
  '42501', NULL,
  'nor map a score to an item');

-- --------------------------------------------------------------- the community
select pg_temp.act_as('00000000-0000-4000-8000-0000000de309');
select isnt_empty(
  $$ select 1 from public.event_guide_sections $$,
  'community reads sections, as it reads game_event_scores (0283)');
select lives_ok(
  $$ select count(*) from public.game_event_score_items $$,
  'and may read the score-item map');
select throws_ok(
  $$ insert into public.event_guides (slug, title) values ('theirs', 'Theirs') $$,
  '42501', NULL,
  'community cannot write a guide');

-- ----------------------------------------------------------------- the officer
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce309');
select lives_ok(
  $$ insert into public.event_guides (slug, title) values ('frost-fair', 'Frost Fair') $$,
  'an officer (guide.write) creates a guide');
select lives_ok(
  $$ update public.event_guides set title = 'Halloween 2026' where slug = 'halloween-2026' $$,
  'and edits somebody else''s (guide.edit)');
select lives_ok(
  $$ insert into public.game_event_score_items (score_id, item_ref, per)
     values ('1000020101', '{"kind": "item", "id": "253042"}', 1) $$,
  'and maps a client score id to an item');
select is(
  (select updated_by from public.event_guides where slug = 'halloween-2026'),
  '00000000-0000-4000-8000-0000000ce309'::uuid,
  'the editor is stamped from the session');

-- A DELETE no `using` clause admits removes nothing and raises nothing, so
-- the thing to assert is survival (46_guides_test says why).
delete from public.event_guides where slug = 'halloween-2026';
select is(
  (select count(*) from public.event_guides where slug = 'halloween-2026'),
  1::bigint,
  'but cannot delete one — guide.delete stays with admins');

-- ------------------------------------------------------------------- the admin
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad309');
select lives_ok(
  $$ delete from public.event_guides where slug = 'halloween-2026' $$,
  'an admin deletes a guide');
select is(
  (select count(*) from public.event_guide_sections s
    where not exists (select 1 from public.event_guides g where g.guide_id = s.guide_id)),
  0::bigint,
  'and its sections go with it');

reset role;

select * from finish();
rollback;
