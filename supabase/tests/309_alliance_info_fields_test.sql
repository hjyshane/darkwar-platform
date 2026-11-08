-- 0309: the alliance's own words and join rules, with the announcement gated
-- per row by membership, not by the request's role.
--
-- Every negative here is paired with a positive on the same rows: a gate that
-- hides the announcement from everybody would fail the admin and member
-- assertions, not pass by silence.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Columns the normalizer (get_al_info 1.1.0) writes and the backfill fills.
select has_column('public', 'alliance_snapshots', c, 'alliance_snapshots has ' || c)
from unnest(array['intro', 'announce', 'language', 'join_approval',
                  'min_power', 'min_hq', 'max_members', 'country']) as c;

select matches(
  col_description('public.alliance_snapshots'::regclass,
    (select attnum from pg_attribute
      where attrelid = 'public.alliance_snapshots'::regclass and attname = 'join_approval')),
  'UNCONFIRMED',
  'join_approval says its meaning is unconfirmed');

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000003a901', 'info-test');

-- Two of ours and a stranger's.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-00000003a9a1', 580, 'ext-info-a', 'Ours A', 'AAA'),
  ('00000000-0000-4000-8000-00000003a9a2', 580, 'ext-info-b', 'Ours B', 'BBB'),
  ('00000000-0000-4000-8000-00000003a9a3', 581, 'ext-info-c', 'Theirs', 'CCC');
update public.alliances
   set is_own = alliance_id in ('00000000-0000-4000-8000-00000003a9a1',
                                '00000000-0000-4000-8000-00000003a9a2')
 where alliance_id in ('00000000-0000-4000-8000-00000003a9a1',
                       '00000000-0000-4000-8000-00000003a9a2',
                       '00000000-0000-4000-8000-00000003a9a3');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000003a9f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'info-community@test.invalid'),
  ('00000000-0000-4000-8000-00000003a9f2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'info-member-a@test.invalid'),
  ('00000000-0000-4000-8000-00000003a9f3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'info-admin@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000003a9f1', 'community', 'community'),
  ('00000000-0000-4000-8000-00000003a9f2', 'member', 'member of A'),
  ('00000000-0000-4000-8000-00000003a9f3', 'admin', 'admin');
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-00000003a9f2', '00000000-0000-4000-8000-00000003a9a1', 'member')
on conflict do nothing;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- One info card per alliance, an older card for A, and a NEWER ranking row
-- for A that carries none of the info fields.
insert into public.alliance_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, external_id, name, code,
   intro, announce, language, join_approval, min_power, min_hq, max_members, country)
values
  (gen_random_uuid(), 'get.al.info', 't', 'info:a:old', '2027-03-01T00:00:00Z',
   '00000000-0000-4000-8000-00000003a901', 580,
   '00000000-0000-4000-8000-00000003a9a1', 580, 'ext-info-a', 'Ours A', 'AAA',
   'intro-a-old', 'old', '391083', 1, 30000000, 20, 100, 'TW'),
  (gen_random_uuid(), 'get.al.info', 't', 'info:a:new', '2027-03-02T00:00:00Z',
   '00000000-0000-4000-8000-00000003a901', 580,
   '00000000-0000-4000-8000-00000003a9a1', 580, 'ext-info-a', 'Ours A', 'AAA',
   'intro-a', 'secret-a', '391083', 1, 30000000, 20, 100, 'TW'),
  (gen_random_uuid(), 'alliance.rank', 't', 'info:a:rank', '2027-03-03T00:00:00Z',
   '00000000-0000-4000-8000-00000003a901', 580,
   '00000000-0000-4000-8000-00000003a9a1', 580, 'ext-info-a', 'Ours A', 'AAA',
   null, null, null, null, null, null, null, null),
  (gen_random_uuid(), 'get.al.info', 't', 'info:b', '2027-03-02T00:00:00Z',
   '00000000-0000-4000-8000-00000003a901', 580,
   '00000000-0000-4000-8000-00000003a9a2', 580, 'ext-info-b', 'Ours B', 'BBB',
   'intro-b', 'secret-b', '390752', 0, null, null, 100, 'US'),
  (gen_random_uuid(), 'get.al.info', 't', 'info:c', '2027-03-02T00:00:00Z',
   '00000000-0000-4000-8000-00000003a901', 581,
   '00000000-0000-4000-8000-00000003a9a3', 581, 'ext-info-c', 'Theirs', 'CCC',
   'intro-c', 'secret-c', '390758', 1, 10000000, 15, 100, 'KR');

-- A community account: the words everybody may read, never the announcement.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003a9f1');
select is((select count(*) from public.alliance_info_latest
            where alliance_id in ('00000000-0000-4000-8000-00000003a9a1',
                                  '00000000-0000-4000-8000-00000003a9a2',
                                  '00000000-0000-4000-8000-00000003a9a3')), 3::bigint,
  'one row per alliance');
select is((select intro from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), 'intro-a',
  'community reads the intro');
select is((select language from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), '391083',
  'community reads the language key');
select is((select join_approval from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), 1,
  'community reads the raw join rule');
select is((select max_members from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), 100,
  'community reads the member cap');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), null,
  'community gets a null announcement for our alliance');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a3'), null,
  'community gets a null announcement for a stranger too');
reset role;

-- A member of own alliance A: A's announcement, not B's. The header could say
-- A while the row is B — that is the hole a role-based gate would open.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003a9f2');
select set_config('request.headers',
  json_build_object('x-alliance-id', '00000000-0000-4000-8000-00000003a9a1')::text, true);
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), 'secret-a',
  'a member reads their own alliance''s announcement');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a2'), null,
  'a member of own alliance A gets null for own alliance B');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a3'), null,
  'and null for a stranger''s');
select is((select captured_at from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'),
  '2027-03-02T00:00:00Z'::timestamptz,
  'the newest info card wins, not the newer ranking row without one');
select is((select intro from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a1'), 'intro-a',
  'a newer rank snapshot does not hide the info card');
reset role;

-- Admin reads every announcement.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003a9f3');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a2'), 'secret-b',
  'admin reads own alliance B''s announcement');
select is((select announce from public.alliance_info_latest
            where alliance_id = '00000000-0000-4000-8000-00000003a9a3'), 'secret-c',
  'admin reads a stranger''s announcement');
reset role;

-- Nothing for anon (0168: anon holds nothing in public).
set local role anon;
select throws_ok($$ select 1 from public.alliance_info_latest $$, '42501',
  null, 'anon cannot read alliance_info_latest');
reset role;

select * from finish();
rollback;
