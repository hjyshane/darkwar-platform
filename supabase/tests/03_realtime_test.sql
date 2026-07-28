-- The default supabase_realtime publication can silently include every
-- table. 0004 pins it to the three notification tables; this asserts the
-- membership stays exact (§10.4).
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select is(
  (select count(*) from pg_publication where pubname = 'supabase_realtime'),
  1::bigint,
  'supabase_realtime publication exists');

select is(
  (select string_agg(tablename::text, ',' order by tablename::text)
   from pg_publication_tables
   where pubname = 'supabase_realtime'),
  'collector_heartbeats,data_change_notifications,refresh_jobs',
  'publication contains exactly the three notification tables');

select * from finish();
rollback;
