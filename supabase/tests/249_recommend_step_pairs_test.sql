-- 0247: the next step of everything an account could advance, in one call.
--
-- B1 (owned at 2, levels 1-3 exist): next is level 3, current power is level 2's.
-- B2 (owned at 1, level 1 has NO power row): current power must be null, not 0.
-- B3 (owned at 3 = its top level): nothing above it, so no pair.
-- B4 (never built, level 1 needs B1 at 5): not returned while B1 is at 2.
-- B5 (never built, level 1 needs B1 at 2): returned, current null.
-- R1 (research owned at 1): next is level 2. R2 needs research R1 at 1: returned.
-- R3 needs research R1 at 9: not returned.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000d501', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rsp-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000d502', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rsp-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000d501', 'member', 'rsp member'),
  ('00000000-0000-4000-8000-00000000d502', 'viewer', 'rsp viewer');

insert into public.game_upgrade_steps (kind, subject_id, level, name, costs, seconds, power, requires) values
  ('building', '991000', 1, 'B1', '[]', 60, 10, '[]'),
  ('building', '991000', 2, 'B1', '[]', 60, 25, '[]'),
  ('building', '991000', 3, 'B1', '[{"type":"resource","id":"24","amount":500}]', 120, 70, '[]'),
  ('building', '992000', 1, 'B2', '[]', 60, null, '[]'),
  ('building', '992000', 2, 'B2', '[]', 60, 40, '[]'),
  ('building', '993000', 1, 'B3', '[]', 60, 5, '[]'),
  ('building', '993000', 2, 'B3', '[]', 60, 8, '[]'),
  ('building', '993000', 3, 'B3', '[]', 60, 9, '[]'),
  ('building', '994000', 1, 'B4', '[]', 60, 5, '[{"subject":"991000","level":5}]'),
  ('building', '995000', 1, 'B5', '[]', 60, 5, '[{"subject":"991000","level":2}]'),
  ('research', '9910', 1, 'R1', '[]', 60, 3, '[]'),
  ('research', '9910', 2, 'R1', '[]', 60, 7, '[]'),
  ('research', '9920', 1, 'R2', '[]', 60, 2, '[{"subject":"9910","level":1,"kind":"research"}]'),
  ('research', '9930', 1, 'R3', '[]', 60, 2, '[{"subject":"9910","level":9,"kind":"research"}]');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

select pg_temp.act_as('00000000-0000-4000-8000-00000000d501');
set local role authenticated;

create temp table pairs on commit drop as
  select e -> 'current' as cur, e -> 'next' as nxt
    from jsonb_array_elements(public.recommend_step_pairs(
      '{"991000": 2, "992000": 1, "993000": 3}'::jsonb,
      '{"9910": 1}'::jsonb)) as e;

select is((select (nxt ->> 'level')::int from pairs where nxt ->> 'subject_id' = '991000'), 3,
  'an owned building returns the step above its level');
select is((select (cur ->> 'power')::int from pairs where nxt ->> 'subject_id' = '991000'), 25,
  'and the power of the level it stands on, so the caller can subtract');
select is((select nxt -> 'costs' -> 0 ->> 'amount' from pairs where nxt ->> 'subject_id' = '991000'), '500',
  'the step carries its cost');

select ok((select cur is not null and cur -> 'power' = 'null'::jsonb from pairs where nxt ->> 'subject_id' = '992000'),
  'a level with no power row is current-with-null-power: unknown, not zero');
select ok(not exists (select 1 from pairs where nxt ->> 'subject_id' = '993000'),
  'a thing at its top level has no next step and no pair');

select ok(not exists (select 1 from pairs where nxt ->> 'subject_id' = '994000'),
  'an unbuilt building whose requirement is unmet is not returned');
select ok(exists (select 1 from pairs where nxt ->> 'subject_id' = '995000' and cur = 'null'::jsonb),
  'an unbuilt building whose requirement is met is returned, with no current');

select is((select (nxt ->> 'level')::int from pairs where nxt ->> 'subject_id' = '9910'), 2,
  'owned research returns its next level');
select ok(exists (select 1 from pairs where nxt ->> 'subject_id' = '9920'),
  'unstarted research whose research requirement is met is returned (kind read from research levels)');
select ok(not exists (select 1 from pairs where nxt ->> 'subject_id' = '9930'),
  'unstarted research whose research requirement is not met is not');

select is((select count(*) from jsonb_array_elements(
    public.recommend_step_pairs(null, '"not an object"'::jsonb)) e where e -> 'current' is distinct from 'null'::jsonb),
  0::bigint,
  'null or non-object levels are tolerated and own nothing: no pair has a current level');

-- A viewer cannot read game_upgrade_steps (member_read), so the function hands back nothing.
select pg_temp.act_as('00000000-0000-4000-8000-00000000d502');
select is(public.recommend_step_pairs('{"991000": 2}'::jsonb, '{}'::jsonb), '[]'::jsonb,
  'a viewer, who cannot read the catalogue, gets an empty array rather than its contents');

reset role;
select ok(not has_function_privilege('anon', 'public.recommend_step_pairs(jsonb, jsonb)', 'execute'),
  'anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.recommend_step_pairs(jsonb, jsonb)', 'execute'),
  'a signed-in user can');

select * from finish();
rollback;
