-- 0342: the alliance page's tower level and start date are a per-alliance
-- setting, and alliance_roster_history carries the levels to count against.
--
-- The view keeps 0077's gate, so the outsider goes first: a column added to a
-- definer view is a new thing a stranger could read if the replace had dropped
-- the predicate.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-0000000cc342', 'trends test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000be342', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'trends-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce342', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'trends-nobody@test.invalid'),
  ('00000000-0000-4000-8000-0000000de342', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'trends-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000be342', 'member', 'trends member'),
  ('00000000-0000-4000-8000-0000000de342', 'viewer', 'trends officer');

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, member_count)
values
  ('00000000-0000-4000-8000-0000000a3421', 580, 'ext-tr-a', 'TrendAlpha', 'TRA', 2),
  ('00000000-0000-4000-8000-0000000a3422', 581, 'ext-tr-b', 'TrendBravo', 'TRB', null);

create function pg_temp.roster(uid bigint, hq int, at timestamptz)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid,
    member_rank, power, hq_level, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'trends:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-0000000cc342', 580,
    '00000000-0000-4000-8000-0000000a3421', 580, uid, 2, 100, hq, false);
$$;

-- One captured_at per batch. The second batch has a member whose level the
-- capture did not carry.
select pg_temp.roster(9342000000000001, 35, '2026-08-04T05:00:00Z');
select pg_temp.roster(9342000000000002, 31, '2026-08-04T05:00:00Z');
select pg_temp.roster(9342000000000001, 35, '2026-08-05T05:00:00Z');
select pg_temp.roster(9342000000000002, null, '2026-08-05T05:00:00Z');

create function pg_temp.as_user(p_uid uuid, p_alliance uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true),
         set_config('request.headers',
           case when p_alliance is null then '{}'
                else json_build_object('x-alliance-id', p_alliance)::text end, true);
$$;

set local role authenticated;

-- 1. The outsider, first.
select pg_temp.as_user('00000000-0000-4000-8000-0000000ce342', null);
select is(
  (select count(*) from public.alliance_roster_history
    where alliance_id = '00000000-0000-4000-8000-0000000a3421'),
  0::bigint,
  'somebody with no app_users row still reads no roster history, levels included');

-- 2-3. A member reads every level of the batch, and a missing level is left out.
select pg_temp.as_user('00000000-0000-4000-8000-0000000be342', null);
select is(
  (select array(select unnest(h.hq_levels) order by 1)
     from public.alliance_roster_history h
    where h.alliance_id = '00000000-0000-4000-8000-0000000a3421'
      and h.captured_at = '2026-08-04T05:00:00Z'),
  array[31, 35],
  'a member reads the tower levels of a capture');
select is(
  (select array[h.observed_members::int, cardinality(h.hq_levels)]
     from public.alliance_roster_history h
    where h.alliance_id = '00000000-0000-4000-8000-0000000a3421'
      and h.captured_at = '2026-08-05T05:00:00Z'),
  array[2, 1],
  'a member with no level in the capture counts as a member and not as a level');
reset role;

-- ---------------------------------------------------------------------------
-- The setting. Alpha is the primary; pinning Bravo freezes its settings.

delete from public.app_settings where key in ('own_alliance', 'alliance_trends');
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000a3421"]}');
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000a3421",
                               "00000000-0000-4000-8000-0000000a3422"]}'
where key = 'own_alliance';

-- 4. An empty override, so Bravo does not follow the primary's later choice.
select is(
  (select value from public.alliance_settings
    where alliance_id = '00000000-0000-4000-8000-0000000a3422' and key = 'alliance_trends'),
  '{}'::jsonb,
  'a newly pinned alliance starts with an empty alliance_trends of its own');

insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-0000000de342', '00000000-0000-4000-8000-0000000a3422', 'officer'),
  ('00000000-0000-4000-8000-0000000de342', '00000000-0000-4000-8000-0000000a3421', 'officer');
update public.role_permissions set allowed = true
 where role = 'officer' and capability = 'settings.write'
   and alliance_id = '00000000-0000-4000-8000-0000000a3422';
update public.role_permissions set allowed = false
 where role = 'officer' and capability = 'settings.write'
   and alliance_id is distinct from '00000000-0000-4000-8000-0000000a3422';

set local role authenticated;

-- 5. Without settings.write (Alpha's grid), the new key is refused like any other.
select pg_temp.as_user('00000000-0000-4000-8000-0000000de342', '00000000-0000-4000-8000-0000000a3421');
select throws_ok(
  $$ select public.save_alliance_setting('alliance_trends', '{"towerLevel": 30}') $$,
  '42501', null,
  'saving alliance_trends needs settings.write in the alliance on screen');

-- 6. With it (Bravo's grid), the key is accepted.
select pg_temp.as_user('00000000-0000-4000-8000-0000000de342', '00000000-0000-4000-8000-0000000a3422');
select lives_ok(
  $$ select public.save_alliance_setting('alliance_trends',
       '{"towerLevel": 30, "since": "2026-11-01"}') $$,
  'Bravo saves its tower level and start date');

-- 7. And a key nobody added is still refused.
select throws_ok(
  $$ select public.save_alliance_setting('alliance_trends_probe', '{}') $$,
  '22023', null,
  'the writer still refuses a key that is not per-alliance');
reset role;

-- 8-9. Bravo reads its own; the primary's shared row was not written.
select is(
  public.alliance_setting('alliance_trends', '00000000-0000-4000-8000-0000000a3422'),
  '{"towerLevel": 30, "since": "2026-11-01"}'::jsonb,
  'Bravo reads back what it saved');
select is(
  (select count(*)::int from public.app_settings where key = 'alliance_trends'),
  0, 'and the primary''s row is untouched');

select * from finish();
rollback;
