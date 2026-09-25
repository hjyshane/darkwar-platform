-- 0165: what a self-service claim may and may not do.
--
-- §20.2 wants the negative case proved rather than assumed, and this function
-- deliberately loosens 0066's rule that an account cannot link itself to a
-- player. So the assertions that matter are the two refusals: a viewer cannot
-- link at all, and nobody can take a character another account already holds.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function('public', 'claim_player', array['uuid']);

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000c1165', 580, 9900000000001651, 'Wanted'),
  ('00000000-0000-4000-8000-0000000c2165', 580, 9900000000001652, 'AlreadyTaken');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000a165', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claimer@example.test', 'x', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000b165', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'holder@example.test', 'x', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000c165', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'outsider@example.test', 'x', now(), now(), now());

insert into public.app_users (user_id, role, player_id)
values
  ('00000000-0000-4000-8000-00000000a165', 'member', null),
  -- Already holds AlreadyTaken, which is what makes the collision real.
  ('00000000-0000-4000-8000-00000000b165', 'member', '00000000-0000-4000-8000-0000000c2165'),
  ('00000000-0000-4000-8000-00000000c165', 'viewer', null);

-- ------------------------------------------------------------- a viewer may not
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-00000000c165","role":"authenticated"}';

select throws_ok(
  $$select public.claim_player('00000000-0000-4000-8000-0000000c1165')$$,
  '42501',
  'members only',
  'a viewer cannot link themselves to a character');

reset role;
select is(
  (select player_id from public.app_users
   where user_id = '00000000-0000-4000-8000-00000000c165'),
  NULL::uuid,
  'and that refusal linked nothing');

-- ------------------------------------------------------------- a member may
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-00000000a165","role":"authenticated"}';

select lives_ok(
  $$select public.claim_player('00000000-0000-4000-8000-0000000c1165')$$,
  'a member links themselves without anyone approving it');

reset role;
select is(
  (select player_id from public.app_users
   where user_id = '00000000-0000-4000-8000-00000000a165'),
  '00000000-0000-4000-8000-0000000c1165'::uuid,
  'the link takes effect in the same call');

-- The audit row keeps its shape: settled, by the person it is about.
select is(
  (select status from public.player_claims
   where user_id = '00000000-0000-4000-8000-00000000a165'),
  'approved',
  'the claim is recorded as decided rather than left pending');

select is(
  (select decided_by from public.player_claims
   where user_id = '00000000-0000-4000-8000-00000000a165'),
  '00000000-0000-4000-8000-00000000a165'::uuid,
  'and it says who settled it');

-- ----------------------------------------------------- somebody else's character
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-00000000a165","role":"authenticated"}';

select throws_ok(
  $$select public.claim_player('00000000-0000-4000-8000-0000000c2165')$$,
  '23505',
  'that player is already linked to another account',
  'a character another account holds cannot be taken');

reset role;
select is(
  (select player_id from public.app_users
   where user_id = '00000000-0000-4000-8000-00000000a165'),
  '00000000-0000-4000-8000-0000000c1165'::uuid,
  'and the refusal left the earlier link alone');

-- Picking again replaces the answer: 0068 kept one row per account for exactly
-- this, and somebody who picked the wrong character must be able to say so.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-00000000a165","role":"authenticated"}';
select public.claim_player('00000000-0000-4000-8000-0000000c1165');
reset role;

select is(
  (select count(*) from public.player_claims
   where user_id = '00000000-0000-4000-8000-00000000a165'),
  1::bigint,
  'claiming again replaces the row rather than adding one');

select * from finish();
rollback;
