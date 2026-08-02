-- 0035: the ranking's source is "the newest row per alliance", stated once.
--
-- The bug this replaces was not a wrong sort — it was a LIMIT counting the
-- wrong thing. `order by captured_at desc limit 200` returns the 200 newest
-- snapshots, not the 200 newest alliances, so an alliance whose only sighting
-- aged out of that window left the ranking. Measured at 250 snapshots: 122 of
-- 129 alliances survived the old query, all 129 survive the view.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-000000000c31', 'alliance-latest-test')
on conflict do nothing;

insert into public.alliances (alliance_id, server_id, external_id, current_name)
values
  ('00000000-0000-4000-8000-0000000a4001', 580, 'ext-aaa', 'A aaa'),
  ('00000000-0000-4000-8000-0000000a4002', 580, 'ext-bbb', 'A bbb');

create function pg_temp.snap(key text, ext text, seen timestamptz, pw bigint)
returns void language sql as $$
  insert into public.alliance_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, alliance_id, external_id,
     name, power)
  select '00000000-0000-4000-8000-00000000f501', 'alliance.rank', 'test', key, seen,
     '00000000-0000-4000-8000-000000000c31', 580, 580, a.alliance_id, ext, 'A ' || ext, pw
  from public.alliances a where a.external_id = ext and a.server_id = 580;
$$;

-- Two sightings of one alliance and one of another. The older sighting is
-- inserted last, so "newest" cannot be satisfied by insertion order.
select pg_temp.snap('t:al:1', 'ext-aaa', '2026-08-01T00:00:00Z', 100);
select pg_temp.snap('t:al:2', 'ext-bbb', '2026-07-01T00:00:00Z', 300);
select pg_temp.snap('t:al:3', 'ext-aaa', '2026-07-01T00:00:00Z', 999);

create function pg_temp.mine() returns setof public.alliance_latest language sql as $$
  select * from public.alliance_latest where external_id in ('ext-aaa', 'ext-bbb');
$$;

select is((select count(*) from pg_temp.mine()), 2::bigint,
  'one row per alliance, however many sightings it has');
select is((select power from pg_temp.mine() where external_id = 'ext-aaa'), 100::bigint,
  'and it is the newest sighting, not the largest or the last inserted');

-- The oldest alliance must survive no matter how much newer history exists
-- for another. This is the case the old query lost.
select pg_temp.snap('t:al:4', 'ext-aaa', '2026-08-02T00:00:00Z', 101);
select pg_temp.snap('t:al:5', 'ext-aaa', '2026-08-03T00:00:00Z', 102);
select pg_temp.snap('t:al:6', 'ext-aaa', '2026-08-04T00:00:00Z', 103);
select is((select count(*) from pg_temp.mine() where external_id = 'ext-bbb'), 1::bigint,
  'an alliance with one old sighting is not crowded out by another''s history');
select is((select power from pg_temp.mine() where external_id = 'ext-aaa'), 103::bigint,
  'and the newest of the crowd is the one kept');

-- security_invoker: a view is otherwise a way to read past a policy, which
-- is what 0016 and 0020 were about closing.
select is(
  (select 'security_invoker=true' = any(reloptions)
   from pg_class where oid = 'public.alliance_latest'::regclass),
  true,
  'the view runs as its caller, so RLS still applies');

set local role anon;
select isnt_empty($$ select * from public.alliance_latest $$,
  'anon reads it, because alliance_snapshots is public_read');
reset role;

select * from finish();
rollback;
