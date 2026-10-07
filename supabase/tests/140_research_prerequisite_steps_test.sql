-- 0243: a research's whole prerequisite tree in one call.
--
-- R1 needs R2 at level 2; R2 needs R3 at level 1 (and a building, which is not
-- followed); R3 needs nothing; R4 is unrelated; R5 and R6 need each other (the
-- walk must stop, not loop).
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000d401', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rps-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000d402', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rps-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000d401', 'member', 'rps member'),
  ('00000000-0000-4000-8000-00000000d402', 'viewer', 'rps viewer');

insert into public.game_upgrade_steps (kind, subject_id, level, name, requires) values
  ('research', '9100', 1, 'R1', '[{"subject":"9200","level":2,"kind":"research"}]'),
  ('research', '9100', 2, 'R1', '[{"subject":"9200","level":2,"kind":"research"}]'),
  ('research', '9200', 1, 'R2', '[{"subject":"9300","level":1,"kind":"research"},{"subject":"403000","level":30}]'),
  ('research', '9200', 2, 'R2', '[{"subject":"9300","level":1,"kind":"research"}]'),
  ('research', '9300', 1, 'R3', '[]'),
  ('research', '9400', 1, 'R4', '[]'),
  ('research', '9500', 1, 'R5', '[{"subject":"9600","level":1,"kind":"research"}]'),
  ('research', '9600', 1, 'R6', '[{"subject":"9500","level":1,"kind":"research"}]'),
  ('building', '403000', 30, 'Research Center', '[]');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

select pg_temp.act_as('00000000-0000-4000-8000-00000000d401');
set local role authenticated;

create temp table r1 on commit drop as
  select e ->> 'subject_id' as subject, (e ->> 'level')::int as level
    from jsonb_array_elements(public.research_prerequisite_steps(array['9100'])) as e;

select is((select count(*) from r1), 5::bigint,
  'R1 returns its own two steps and every step of the two researches it needs, through others');
select is((select array_agg(distinct subject order by subject) from r1), array['9100', '9200', '9300'],
  'the three researches in the chain');
select ok(not exists (select 1 from r1 where subject = '9400'), 'an unrelated research is not returned');
select ok(not exists (select 1 from r1 where subject = '403000'),
  'a building requirement is not followed: only research is');

select is(public.research_prerequisite_steps(array['9300']) -> 0 ->> 'name', 'R3',
  'a research with no prerequisites returns just itself');
select is(public.research_prerequisite_steps(array[]::text[]), '[]'::jsonb,
  'no subjects, no steps');
select is(public.research_prerequisite_steps(array['no-such-research']), '[]'::jsonb,
  'a subject the game does not have returns nothing');
select is(jsonb_array_length(public.research_prerequisite_steps(array['9500'])), 2,
  'two researches that need each other end the walk instead of looping');
select is(public.research_prerequisite_steps(array['9100']) -> 0 -> 'requires' -> 0 ->> 'kind', 'research',
  'the requirements come back as stored, kind and all');

reset role;
select ok(not has_function_privilege('anon', 'public.research_prerequisite_steps(text[])', 'execute'),
  'anon cannot call it');

select * from finish();
rollback;
