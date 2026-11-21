-- 0343: the client's raw datatables. The service key writes them in full and
-- an admin reads them; an officer, a member, community and anon read nothing
-- (RLS filters a select to no rows rather than refusing it, so the negatives
-- are counts of zero); nobody signed in writes. Dropping a table takes its
-- rows, strings and names with it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000003430101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gd-admin@test.invalid'),
  ('00000000-0000-4000-8000-000003430102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gd-officer@test.invalid'),
  ('00000000-0000-4000-8000-000003430103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gd-member@test.invalid'),
  ('00000000-0000-4000-8000-000003430104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'gd-community@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-000003430101', 'admin'),
  ('00000000-0000-4000-8000-000003430102', 'officer'),
  ('00000000-0000-4000-8000-000003430103', 'member'),
  ('00000000-0000-4000-8000-000003430104', 'community')
on conflict (user_id) do update set role = excluded.role;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- 1-2. The dump tool, as service_role, writes a table with its pieces.
set local role service_role;
select lives_ok(
  $$ insert into public.game_datatables
       (name, client_version, columns, loc_columns, row_count, chunk_count, byte_size)
     values ('goods', '1645', '["id","name","quality"]', '["name"]', 2, 1, 120) $$,
  'the service key writes a table');
select lives_ok(
  $$ insert into public.game_datatable_rows (table_name, chunk, rows) values
       ('goods', 0, '{"230101":{"id":230101,"name":"300001","quality":4},
                     "230102":{"id":230102,"name":"300002","quality":3}}');
     insert into public.game_datatable_strings (table_name, lang, strings) values
       ('goods', 'en', '{"300001":"Precision Part","300002":"Titanium Alloy"}'),
       ('goods', 'ko', '{"300001":"정밀 부품"}');
     insert into public.game_datatable_names (table_name, row_id, name_en, name_ko) values
       ('goods', '230101', 'Precision Part', '정밀 부품'),
       ('goods', '230102', 'Titanium Alloy', null) $$,
  'and its rows, strings and names');
reset role;

-- 3-4. Shapes: a table name is a datatable name; rows are an object.
set local role service_role;
select throws_ok(
  $$ insert into public.game_datatables
       (name, client_version, columns, row_count, chunk_count, byte_size)
     values ('Goods; drop', '1', '[]', 0, 0, 0) $$,
  '23514', null, 'a table name is lower-case letters, digits and underscores');
select throws_ok(
  $$ insert into public.game_datatable_rows (table_name, chunk, rows)
     values ('goods', 1, '[1,2]') $$,
  '23514', null, 'a chunk is an object keyed by row id');
reset role;

-- 5-8. An admin reads all four.
select pg_temp.act_as('00000000-0000-4000-8000-000003430101');
set local role authenticated;
select is((select count(*)::int from public.game_datatables), 1, 'an admin sees the table');
select is((select rows -> '230101' ->> 'name' from public.game_datatable_rows
            where table_name = 'goods' and chunk = 0), '300001', 'and its rows');
select is((select strings ->> '300001' from public.game_datatable_strings
            where table_name = 'goods' and lang = 'ko'), '정밀 부품', 'and its Korean strings');
select is((select table_name from public.game_datatable_names
            where name_en ilike '%titanium%'), 'goods', 'and finds a name across tables');

-- 9. An admin does not write: the client's files are the dump tool's to write.
select throws_ok(
  $$ update public.game_datatables set client_version = 'edited' where name = 'goods' $$,
  '42501', null, 'an admin cannot edit a table');

-- 10-13. An officer, a member and community read nothing.
select pg_temp.act_as('00000000-0000-4000-8000-000003430102');
select is((select count(*)::int from public.game_datatables), 0, 'an officer sees no tables');
select is((select count(*)::int from public.game_datatable_names), 0, 'nor any names');
select pg_temp.act_as('00000000-0000-4000-8000-000003430103');
select is((select count(*)::int from public.game_datatable_rows), 0, 'a member sees no rows');
select pg_temp.act_as('00000000-0000-4000-8000-000003430104');
select is((select count(*)::int from public.game_datatable_strings), 0,
  'community sees no strings');
reset role;

-- 14. Anon has no grant at all.
set local role anon;
select throws_ok(
  $$ select count(*) from public.game_datatables $$,
  '42501', null, 'anon cannot read the tables');
reset role;

-- 15-16. Removing a table takes its pieces with it.
set local role service_role;
delete from public.game_datatables where name = 'goods';
select is((select count(*)::int from public.game_datatable_rows where table_name = 'goods'), 0,
  'dropping a table drops its rows');
select is((select count(*)::int from public.game_datatable_names where table_name = 'goods'), 0,
  'and its names');
reset role;

select * from finish();
rollback;
