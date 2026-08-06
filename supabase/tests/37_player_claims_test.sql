-- 0068: the member says, the admin decides, and the member cannot decide.
--
-- The assertion that matters is the third one. 0066 made linking an account
-- to a player the thing that opens that player's history, so a claim flow
-- that a member could approve for themselves would hand out exactly what
-- 0066 withheld. Everything else here is ordinary; that one is the point.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-viewer@test.invalid'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000000c1', 'member', 'claim member'),
  ('00000000-0000-4000-8000-0000000000c2', 'admin', 'claim admin'),
  ('00000000-0000-4000-8000-0000000000c3', 'viewer', 'claim viewer'),
  ('00000000-0000-4000-8000-0000000000c4', 'officer', 'claim officer');

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 580, 901000580, 'Claimed One'),
  ('00000000-0000-4000-8000-0000000000a2'::uuid, 580, 902000580, 'Claimed Two');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- A member states who they are.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c1');
select lives_ok($$
  insert into public.player_claims (user_id, player_id, note)
  values ('00000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-0000000000a1', 'this is me')
$$, 'a member may claim a character');

-- And nothing has been granted by saying it.
select is(
  (select player_id from public.app_users where user_id = '00000000-0000-4000-8000-0000000000c1'),
  null, 'the claim alone does not link the account');

-- THE ONE THAT MATTERS. Approving your own claim would be self-service
-- linking, which is what 0066 refused.
select throws_ok($$
  update public.player_claims set status = 'approved'
  where user_id = '00000000-0000-4000-8000-0000000000c1'
$$, '42501', null, 'a member cannot approve their own claim');

select throws_ok($$
  select public.approve_player_claim('00000000-0000-4000-8000-0000000000c1')
$$, '42501', null, 'nor call the function that would');

-- Nor claim on somebody else's behalf.
select throws_ok($$
  insert into public.player_claims (user_id, player_id)
  values ('00000000-0000-4000-8000-0000000000c2',
          '00000000-0000-4000-8000-0000000000a2')
$$, '42501', null, 'nor file a claim for another account');
reset role;

-- A viewer has no business claiming: they cannot see the roster to pick
-- from, and the order is code first, then identity.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c3');
select throws_ok($$
  insert into public.player_claims (user_id, player_id)
  values ('00000000-0000-4000-8000-0000000000c3',
          '00000000-0000-4000-8000-0000000000a2')
$$, '42501', null, 'a viewer cannot claim');
select is_empty($$ select * from public.player_claims $$,
  'and sees nobody else''s claim');
reset role;

-- AN OFFICER SEES EVERYBODY'S, and that is by design — they are who approves a
-- claim. Two select policies exist and RLS ORs them: `self_read` for your own row,
-- `manage_read` for anybody with `members.manage`, which officers have.
--
-- Pinned because a client that forgot it shipped. `PlayerClaimForm` fetched "my
-- claim" with no user_id filter, trusting `self_read` to scope it — so a brand-new
-- officer read the one row in the table, somebody else's approved claim, and was
-- told "this account is linked to WonderingDuck" with no form to claim their own.
-- The policy is right; the query has to say which row is MINE.
--
-- THE GRANT IS SET HERE RATHER THAN ASSUMED. `role_permissions` is a grid an admin
-- edits in the dashboard, and the deployed one gives officers `members.manage`
-- while the seeded default does not — which is exactly why this shipped: locally
-- the officer saw nothing and the bug was invisible. So the test states the
-- condition it is about instead of depending on a default that can be toggled.
update public.role_permissions
   set allowed = true
 where role = 'officer' and capability = 'members.manage';

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c4');
select isnt_empty(
  $$ select * from public.player_claims
      where user_id = '00000000-0000-4000-8000-0000000000c1' $$,
  'an officer sees another account''s claim — so a client asking for "mine" must filter');
select is_empty(
  $$ select * from public.player_claims
      where user_id = (select auth.uid()) $$,
  'and filtering by their own uid correctly finds they have not claimed anything');
reset role;

-- The admin decides, and that is what moves app_users.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c2');
select isnt_empty($$ select * from public.player_claims where status = 'pending' $$,
  'an admin sees the pending claim');
select lives_ok($$
  select public.approve_player_claim('00000000-0000-4000-8000-0000000000c1')
$$, 'and can approve it');
select is(
  (select player_id from public.app_users where user_id = '00000000-0000-4000-8000-0000000000c1'),
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'which is what links the account');
reset role;

-- One player, one account. 0066's partial unique index says so; this makes
-- the failure legible instead of an index name in a 23505.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c3');
reset role;
insert into public.player_claims (user_id, player_id, status)
values ('00000000-0000-4000-8000-0000000000c3',
        '00000000-0000-4000-8000-0000000000a1', 'pending');

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c2');
select throws_ok($$
  select public.approve_player_claim('00000000-0000-4000-8000-0000000000c3')
$$, '23505', null, 'a character already linked cannot be claimed by a second account');
reset role;

select * from finish();
rollback;
