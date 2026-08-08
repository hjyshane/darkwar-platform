-- 0094: leaving, and being removed.
--
-- The thing this must not regress is the reason it exists: nine foreign keys
-- pointed at the account with no `on delete` clause, so an account that had
-- ever done anything could not be deleted. A test that only proves the happy
-- path would pass against a fresh account and fail against every real one, so
-- the fixture below makes the account MESSY first — an invitation, a decided
-- claim, a notice, a guide, a setting, a rank and an audit row — and then
-- removes it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000fb001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leave-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000fb002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leave-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000fb003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leave-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000fb004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leave-admin2@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000fb001', 'admin', 'leave admin'),
  ('00000000-0000-4000-8000-0000000fb002', 'officer', 'leave officer'),
  ('00000000-0000-4000-8000-0000000fb003', 'member', 'leave member'),
  ('00000000-0000-4000-8000-0000000fb004', 'admin', 'leave admin two');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Everything the member has touched. Each row is one of the nine foreign
-- keys, and each one on its own used to make the delete raise 23503.
insert into public.join_codes (code, grants_role, created_by)
  values ('LEAVE1', 'member', '00000000-0000-4000-8000-0000000fb003');
insert into public.audit_logs (actor_user_id, action, entity_type)
  values ('00000000-0000-4000-8000-0000000fb003', 'test.acted', 'nothing');
insert into public.announcements (title, body, created_by)
  values ('a notice', 'body', '00000000-0000-4000-8000-0000000fb003');
insert into public.guides (title, body, created_by)
  values ('a guide', 'body', '00000000-0000-4000-8000-0000000fb003');
insert into public.app_settings (key, value, updated_by)
  values ('leave_test_key', '"x"'::jsonb, '00000000-0000-4000-8000-0000000fb003');

-- 1-2. The permission boundary, before anything is deleted.
select pg_temp.act_as('00000000-0000-4000-8000-0000000fb003');
select throws_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb002') $$,
  '42501',
  'members.manage is required to remove a member',
  'a member cannot remove anybody');

select pg_temp.act_as('00000000-0000-4000-8000-0000000fb002');
select throws_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb003') $$,
  '42501',
  'members.manage is required to remove a member',
  'an officer without the capability cannot either — the role is not the check');

-- 3. Granting the capability is what opens it, not being an officer.
update public.role_permissions set allowed = true
  where role = 'officer' and capability = 'members.manage';

-- 4-5. Still refused for the two cases that are not about permission.
select pg_temp.act_as('00000000-0000-4000-8000-0000000fb002');
select throws_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb002') $$,
  '23514',
  'use leave_alliance() to remove yourself',
  'removing yourself is a different act and says so');

select throws_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb001') $$,
  '42501',
  'only an admin can remove an admin',
  'members.manage must not be a capability an admin can grant away their own account with');

-- 6. The removal itself, against the messy account.
select lives_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb003') $$,
  'an account that has done things can still be removed');

select is(
  (select count(*)::int from public.app_users
    where user_id = '00000000-0000-4000-8000-0000000fb003'),
  0, 'the app_users row is gone');

-- 7-11. Everything they wrote survives, orphaned rather than deleted.
select is(
  (select created_by from public.join_codes where code = 'LEAVE1'),
  null, 'the invitation they issued keeps working, with no issuer');
select is(
  (select created_by from public.announcements where title = 'a notice'),
  null, 'the notice survives its author');
select is(
  (select created_by from public.guides where title = 'a guide'),
  null, 'so does the guide');
select is(
  (select updated_by from public.app_settings where key = 'leave_test_key'),
  null, 'and the setting they saved');
select is(
  (select count(*)::int from public.audit_logs where action = 'test.acted'),
  1, 'the audit row is kept, not cascaded away with its actor');

-- 12-13. The departure is on the record, with the name that no longer exists
-- anywhere else. `actor_user_id` is set null for a departure by definition,
-- so the jsonb is the only place this can live.
select is(
  (select before ->> 'display_name' from public.audit_logs
    where action = 'app_users.removed'
      and entity_id = '00000000-0000-4000-8000-0000000fb003'),
  'leave member', 'the removal records who it was, after the name is unreachable');
select is(
  (select actor_user_id from public.audit_logs
    where action = 'app_users.removed'
      and entity_id = '00000000-0000-4000-8000-0000000fb003'),
  '00000000-0000-4000-8000-0000000fb002'::uuid,
  'and who did it — the remover, not the removed');

-- 14. The login survives. Leaving is not deleting the account.
select is(
  (select count(*)::int from auth.users
    where id = '00000000-0000-4000-8000-0000000fb003'),
  1, 'the login stays, so a join code can admit them again');

-- 15. Removing an absent account is not an error. Two tabs, one button.
select lives_ok(
  $$ select public.remove_member('00000000-0000-4000-8000-0000000fb003') $$,
  'removing somebody already gone is the state the caller wanted');

-- 16-17. Leaving, by the person leaving. The officer may not remove
-- themselves, but they may leave.
select pg_temp.act_as('00000000-0000-4000-8000-0000000fb002');
select lives_ok(
  $$ select public.leave_alliance() $$,
  'an officer can give up their own access');
select is(
  (select count(*)::int from public.app_users
    where user_id = '00000000-0000-4000-8000-0000000fb002'),
  0, 'and the row goes');

-- 18. The one door with no lock on the inside. Two admins exist in this
-- fixture, so one may leave; the second may not.
select pg_temp.act_as('00000000-0000-4000-8000-0000000fb004');
select lives_ok($$ select public.leave_alliance() $$, 'an admin may leave while another remains');

select pg_temp.act_as('00000000-0000-4000-8000-0000000fb001');
select throws_ok(
  $$ select public.leave_alliance() $$,
  '23514',
  'the last admin cannot leave; make somebody else an admin first',
  'the last admin cannot lock everybody out');

-- 20-22. Who may CALL these at all (0095).
--
-- READ THIS BEFORE TRUSTING THE TWO BELOW. They cannot fail for the reason
-- 0095 exists, and pretending otherwise would be worse than not having them.
--
-- The hosted project ships `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN
-- SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated`, so every
-- function created there is granted to those roles directly at creation.
-- Revoking from `public` does not touch a direct grant to a named role, so
-- 0094's revoke ran, reported success, and left an unguarded audit-log
-- writer reachable by an anonymous request.
--
-- The LOCAL stack has no such default. `anon` holds execute on nothing here
-- — not on these, not on `approve_player_claim`, which has only ever been
-- revoked from `public` either. So both assertions were already true before
-- 0095, and a run of this file against a fresh local database is no evidence
-- at all about production.
--
-- What they do buy is a floor: a later migration that GRANTS one of these to
-- anon fails here. The drift that 0095 actually fixes is only visible
-- against the hosted project, with `supabase db diff --linked` — which is
-- now a step in the going-public runbook, because it is the only thing that
-- would have caught this.
select ok(
  not has_function_privilege('anon', 'public.record_departure(uuid, text)', 'execute'),
  'nobody grants record_departure to anon — it has no check of its own');
select ok(
  not has_function_privilege('authenticated', 'public.record_departure(uuid, text)', 'execute'),
  'nor to a signed-in caller; its only callers are SECURITY DEFINER');

-- The other two stay reachable on purpose. Each opens with its own refusal,
-- which is the right way round: a guard, not a grant, is what makes a
-- function safe to expose.
select ok(
  has_function_privilege('authenticated', 'public.leave_alliance()', 'execute'),
  'leaving stays callable by anyone signed in — it guards itself');

select * from finish();
rollback;
