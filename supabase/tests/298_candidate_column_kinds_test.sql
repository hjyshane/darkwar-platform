-- 0298: a candidate column has a kind, and a dropdown has a list of choices.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select is((select kind from public.migration_candidate_columns where label = 'Notes'), 'note',
          'the starting Notes column is a note');
select lives_ok(
  $$ insert into public.migration_candidate_columns (label) values ('Free') $$,
  'a column with no kind is text');
select is((select kind from public.migration_candidate_columns where label = 'Free'), 'text',
          'and says so');
select lives_ok(
  $$ insert into public.migration_candidate_columns (label, kind, options)
     values ('Status', 'dropdown', '["Asked", "Accepted"]'::jsonb) $$,
  'a dropdown with choices is accepted');
select throws_ok(
  $$ insert into public.migration_candidate_columns (label, kind) values ('Empty', 'dropdown') $$,
  '23514', null, 'a dropdown with no choices is refused');
select throws_ok(
  $$ insert into public.migration_candidate_columns (label, kind, options)
     values ('Odd', 'text', '["x"]'::jsonb) $$,
  '23514', null, 'and choices on any other kind are');
select throws_ok(
  $$ insert into public.migration_candidate_columns (label, kind, options)
     values ('Mixed', 'dropdown', '["a", 3]'::jsonb) $$,
  '23514', null, 'a choice that is not text is refused');
select throws_ok(
  $$ insert into public.migration_candidate_columns (label, kind) values ('Bad', 'date') $$,
  '23514', null, 'an unknown kind is refused');

select * from finish();
rollback;
