-- 0282/0283: the community role reads game-wide pages and none of ours.
--
-- Every negative runs against rows this file inserts, and each is paired with
-- a positive in the same shape, so a gate that closes on everyone cannot pass.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000fc001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'community@test.invalid'),
  ('00000000-0000-4000-8000-0000000fc002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cmember@test.invalid'),
  ('00000000-0000-4000-8000-0000000fc003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cjoiner@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000fc001', 'community', 'community'),
  ('00000000-0000-4000-8000-0000000fc002', 'member', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Two alliances: ours (is_own) and a stranger's, each with one roster row.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000fca01', 580, 'ext-cm-own', 'Ours', 'OWN'),
  ('00000000-0000-4000-8000-0000000fca02', 581, 'ext-cm-other', 'Theirs', 'OTH');

insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-0000000fcb01', 580, 9600000001000580, 'OurPerson'),
  ('00000000-0000-4000-8000-0000000fcb02', 581, 9600000002000581, 'TheirPerson');

update public.players set current_alliance_id = '00000000-0000-4000-8000-0000000fca01'
where player_id = '00000000-0000-4000-8000-0000000fcb01';

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, power)
values
  ('00000000-0000-4000-8000-0000000fcc01', 'al.rank', 'test', 'test:cm:own',
   '2027-02-01T00:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000fca01', 580,
   '00000000-0000-4000-8000-0000000fcb01', 9600000001000580, 'OurPerson', 100),
  ('00000000-0000-4000-8000-0000000fcc02', 'al.rank', 'test', 'test:cm:other',
   '2027-02-01T00:00:00Z', '00000000-0000-4000-8000-000000000c01', 580,
   '00000000-0000-4000-8000-0000000fca02', 581,
   '00000000-0000-4000-8000-0000000fcb02', 9600000002000581, 'TheirPerson', 100);

-- Inserting a roster re-derives is_own (0192), so pin it after the rosters are in.
update public.alliances set is_own = (alliance_id = '00000000-0000-4000-8000-0000000fca01')
where alliance_id in ('00000000-0000-4000-8000-0000000fca01',
                      '00000000-0000-4000-8000-0000000fca02');

-- The role resolves to itself: no membership, so app_users.role stands.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc001');
select is(public.current_app_role(), 'community'::public.app_role,
  'a community account is a community account');

-- Reads it was given.
select isnt_empty($$ select 1 from public.players $$,
  'community reads players (rankings, planner claim search)');
select isnt_empty($$ select 1 from public.alliances $$,
  'community reads alliances (rankings)');
select isnt_empty($$ select 1 from public.servers $$,
  'community reads servers (overview)');

-- The roster of an alliance that is not ours: yes. Ours: never.
select results_eq(
  $$ select name from public.alliance_member_snapshots order by name $$,
  $$ values ('TheirPerson'::text) $$,
  'community sees another alliance''s roster and not ours');
reset role;

-- A member still sees both rosters? No - own-or-officer (0066): a member sees
-- neither, which is the existing rule this file must not have changed.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc002');
select is_empty($$ select 1 from public.alliance_member_snapshots $$,
  'a plain member is as before: no rosters');
reset role;

-- Not given.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc001');
select is_empty(
  $$ select 1 from public.app_users
      where user_id <> '00000000-0000-4000-8000-0000000fc001' $$,
  'community cannot list anyone else''s account');
select is(public.has_permission('data.enter'), false,
  'community may not enter data by hand');
select is(public.has_permission('members.manage'), false,
  'community manages no members');
select is(public.has_permission('arena.view'), true,
  'community is offered the arena board');
reset role;

-- The grant: structure, because a table that has no row to read is not a test.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual like '%community%'
      and tablename in ('member_roster_current', 'player_contributions',
                        'player_presence', 'announcements', 'guides',
                        'schedule_events', 'alliance_event_times',
                        'hive_formations', 'player_ranks', 'sync_status',
                        'event_attendance', 'black_money_score_snapshots')),
  0::bigint,
  'no own-alliance table names community');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual like '%community%'
      and tablename in ('game_event_themes', 'event_schedule_snapshots',
                        'game_upgrade_steps', 'shop_pack_snapshots',
                        'migration_events', 'world_city_snapshots',
                        'arena_entries', 'player_snapshots')),
  8::bigint,
  'each page''s reference tables name community');

-- Redeeming a community code.
insert into public.join_codes (code, grants_role, note)
values ('COMMUNITY-TEST', 'community', 'test');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc003');
select is(public.redeem_join_code('COMMUNITY-TEST'), 'community'::public.app_role,
  'a community code admits as community');
select is(public.current_app_role(), 'community'::public.app_role,
  'and the account is then a community account');
reset role;

select is(
  (select count(*) from public.alliance_memberships
    where user_id = '00000000-0000-4000-8000-0000000fc003'),
  0::bigint,
  'it writes no alliance membership');

-- A member redeeming one keeps being a member.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc002');
select is(public.redeem_join_code('COMMUNITY-TEST'), 'member'::public.app_role,
  'a member who redeems a community code is not downgraded');
reset role;

-- Claiming a character.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc003');
select isnt(
  (select player_id::text from public.claim_player('00000000-0000-4000-8000-0000000fcb02')),
  null,
  'community may claim a character outside the alliance');
select throws_ok(
  $$ select * from public.claim_player('00000000-0000-4000-8000-0000000fcb01') $$,
  '42501', null,
  'but not one whose last-known alliance is ours');
reset role;

-- Promotion: admitted to the alliance, the account becomes a member.
insert into public.join_codes (code, grants_role, note)
values ('MEMBER-TEST', 'member', 'test');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000fc003');
select is(public.redeem_join_code('MEMBER-TEST'), 'member'::public.app_role,
  'a community account that redeems a member code is promoted');
reset role;

select * from finish();
rollback;
