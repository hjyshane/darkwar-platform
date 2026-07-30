-- 0012: seen_count must count. It read 1 forever while sync ignored
-- duplicates, which made a constant unknown command look like a one-off.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.schema_observations
  (source_command, fingerprint, sample, first_seen_at, last_seen_at)
values
  ('get.battlepass.info', 'abc123', '{"season": "integer"}'::jsonb,
   '2026-07-30T10:00:00Z', '2026-07-30T10:00:00Z');

select is((select seen_count from public.schema_observations
           where fingerprint = 'abc123'), 1, 'a new shape starts at one');

-- Seeing it again, as sync now does: merge on the natural key.
insert into public.schema_observations
  (source_command, fingerprint, sample, first_seen_at, last_seen_at, review_status)
values
  ('get.battlepass.info', 'abc123', '{"season": "integer"}'::jsonb,
   '2026-07-30T12:00:00Z', '2026-07-30T12:00:00Z', 'new')
on conflict (source_command, fingerprint) do update
set last_seen_at = excluded.last_seen_at,
    first_seen_at = excluded.first_seen_at,
    review_status = excluded.review_status;

select is((select seen_count from public.schema_observations
           where fingerprint = 'abc123'), 2, 'a repeat sighting increments');
select is((select first_seen_at from public.schema_observations
           where fingerprint = 'abc123'), '2026-07-30T10:00:00Z'::timestamptz,
  'first_seen_at never moves forward');
select is((select last_seen_at from public.schema_observations
           where fingerprint = 'abc123'), '2026-07-30T12:00:00Z'::timestamptz,
  'last_seen_at advances');

-- An operator marking the command reviewed is not a sighting: the status
-- must stick and the count must not move.
update public.schema_observations set review_status = 'mapped'
where fingerprint = 'abc123';

select is((select review_status from public.schema_observations
           where fingerprint = 'abc123'), 'mapped',
  'an operator can record a review decision');
select is((select seen_count from public.schema_observations
           where fingerprint = 'abc123'), 2,
  'an operator edit does not inflate the count');

-- And a later sighting counts without undoing that decision.
insert into public.schema_observations
  (source_command, fingerprint, sample, first_seen_at, last_seen_at, review_status)
values
  ('get.battlepass.info', 'abc123', '{"season": "integer"}'::jsonb,
   '2026-07-30T13:00:00Z', '2026-07-30T13:00:00Z', 'new')
on conflict (source_command, fingerprint) do update
set last_seen_at = excluded.last_seen_at,
    first_seen_at = excluded.first_seen_at,
    review_status = excluded.review_status;

select is((select (seen_count, review_status)::text from public.schema_observations
           where fingerprint = 'abc123'), '(3,mapped)',
  'a later sighting counts and leaves the review decision alone');

select * from finish();
rollback;
