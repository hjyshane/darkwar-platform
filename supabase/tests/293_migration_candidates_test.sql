-- 0293: the candidate list belongs to people who manage migrations, and its wished-for
-- alliance has to be one of ours.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.alliances (alliance_id, server_id, external_id, current_name) values
  ('00000000-0000-4000-8000-0000000a3a01', 580, 'ext-cand-ours', 'OursCand'),
  ('00000000-0000-4000-8000-0000000a3a02', 581, 'ext-cand-theirs', 'TheirsCand');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a3f01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cand-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000a3f02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cand-officer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000a3f01', 'member'),
  ('00000000-0000-4000-8000-0000000a3f02', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

select is((select label from public.migration_candidate_columns), 'Notes',
          'the table starts with a Notes column');

set local role authenticated;

-- An officer: the positive first, so a refusal below cannot be an empty table.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a3f02');
select lives_ok(
  $$ insert into public.migration_candidates (query, desired_alliance_id)
     values ('Alpha', '00000000-0000-4000-8000-0000000a3a01') $$,
  'an officer adds a candidate wanting one of our alliances');
select isnt_empty($$ select 1 from public.migration_candidates $$, 'and reads it back');

select throws_ok(
  $$ insert into public.migration_candidates (query, desired_alliance_id)
     values ('Bravo', '00000000-0000-4000-8000-0000000a3a02') $$,
  '23514', null, 'an alliance of another server is refused');
select throws_ok(
  $$ insert into public.migration_candidates (query) values ('  alpha ') $$,
  '23505', null, 'the same name twice is one candidate, ignoring case and spaces');
select lives_ok(
  $$ update public.migration_candidates set extra = jsonb_build_object('c1', 'called') $$,
  'and a cell of an extra column can be written');

-- A member sees nothing and writes nothing.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a3f01');
select is_empty($$ select 1 from public.migration_candidates $$,
                'a member does not see the candidates at all');
select throws_ok(
  $$ insert into public.migration_candidates (query) values ('Sneaky') $$,
  '42501', null, 'and cannot add one');
select is_empty($$ select 1 from public.migration_candidate_columns $$,
                'nor read the columns');

select * from finish();
rollback;
