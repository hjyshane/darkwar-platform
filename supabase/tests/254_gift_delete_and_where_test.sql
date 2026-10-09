-- 0253: every UPDATE the gift sender runs says WHERE (hosted Supabase's
-- pg_safeupdate refuses one that does not, and neither this harness nor CI loads
-- it), and an officer can delete a code from the list without erasing another
-- alliance's history.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- ----------------------------------------------- the guard pg_safeupdate needs
-- The extension is not available here, so check the source instead: each
-- `update internal.gift_runner` in the sender's functions must be matched by a
-- `where singleton`.
with src as (
  select p.prosrc
  from pg_proc p
  where p.pronamespace = 'internal'::regnamespace
    and p.proname in ('gift_apply_answer', 'set_gift_runner', 'gift_send_next', 'gift_settle')
)
select is(
  (select coalesce(sum(array_length(regexp_split_to_array(prosrc, 'update internal\.gift_runner'), 1) - 1), 0)
   from src),
  (select coalesce(sum(array_length(regexp_split_to_array(prosrc, 'where singleton'), 1) - 1), 0)
   from src),
  'every update of the runner row has a WHERE, which the hosted database requires');

-- ---------------------------------------------------------------------- fixtures
update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000fc01', 580, 'ext-del', 'DeleteTest', true, 0),
  ('00000000-0000-4000-8000-00000000fc02', 580, 'ext-del2', 'OtherDelete', false, 0);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000fc01"}');
select public.resolve_own_alliance();

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000fd01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'del-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000fd02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'del-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000fd01', 'member', 'del member'),
  ('00000000-0000-4000-8000-00000000fd02', 'officer', 'del officer');
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.gift_codes (code_id, code, status) values
  ('00000000-0000-4000-8000-00000000fe01', 'SHAREDONE', 'working'),
  ('00000000-0000-4000-8000-00000000fe02', 'MINEONLY', 'working'),
  ('00000000-0000-4000-8000-00000000fe03', 'NOCLAIMS', 'unverified');
insert into public.gift_code_claims (code_id, alliance_id, game_uid, status) values
  ('00000000-0000-4000-8000-00000000fe01', '00000000-0000-4000-8000-00000000fc01', 9540000000000001, 'done'),
  ('00000000-0000-4000-8000-00000000fe01', '00000000-0000-4000-8000-00000000fc02', 9540000000000002, 'done'),
  ('00000000-0000-4000-8000-00000000fe02', '00000000-0000-4000-8000-00000000fc01', 9540000000000001, 'queued'),
  ('00000000-0000-4000-8000-00000000fe02', '00000000-0000-4000-8000-00000000fc01', 9540000000000003, 'running');

-- ------------------------------------------------------------------- who may
select ok(
  not has_function_privilege('anon', 'public.delete_gift_code(uuid)', 'execute'),
  'anon cannot delete a code');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000fd01');
select throws_ok(
  $$ select public.delete_gift_code('00000000-0000-4000-8000-00000000fe03') $$,
  '42501', null, 'a member cannot delete a code');

-- ---------------------------------------------------------------- the deleting
select pg_temp.act_as('00000000-0000-4000-8000-00000000fd02');

select is(
  public.delete_gift_code('00000000-0000-4000-8000-00000000fe01'), 1,
  'deleting a code removes this alliance''s claims for it');
reset role;
select ok(
  exists (select 1 from public.gift_codes where code_id = '00000000-0000-4000-8000-00000000fe01')
  and exists (select 1 from public.gift_code_claims
              where code_id = '00000000-0000-4000-8000-00000000fe01'
                and alliance_id = '00000000-0000-4000-8000-00000000fc02'),
  'but the code stays while another alliance still has claims on it');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000fd02');
select is(
  public.delete_gift_code('00000000-0000-4000-8000-00000000fe02'), 2,
  'a code only this alliance used goes, with its queued and in-flight claims');
reset role;
select is(
  (select count(*)::int from public.gift_codes
   where code_id = '00000000-0000-4000-8000-00000000fe02'),
  0, 'and the code itself is gone');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000fd02');
select is(
  public.delete_gift_code('00000000-0000-4000-8000-00000000fe03')
  + public.delete_gift_code('00000000-0000-4000-8000-00000000ffff'),
  0, 'a code with no claims is deleted, and an unknown id is not an error');
reset role;

select * from finish();
rollback;
