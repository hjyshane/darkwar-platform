-- 0252: the database-side gift sender. pg_net is not available to the suite, so
-- what is tested is everything around the HTTP call: how an answer is read, what
-- each kind does to the claim, the code and the runner, and that a disabled
-- runner sends nothing. The refusals are first: this feature is off by default
-- and unreachable from the API roles.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ------------------------------------------------------------ not reachable
select ok(
  not has_function_privilege('authenticated', 'internal.set_gift_runner(boolean, text)', 'execute')
  and not has_function_privilege('anon', 'internal.gift_send_next()', 'execute')
  and not has_function_privilege('authenticated', 'internal.gift_apply_answer(uuid, text, jsonb, text)', 'execute'),
  'no API role can turn the runner on or settle a claim');

select ok(
  not has_table_privilege('authenticated', 'internal.gift_runner', 'select')
  and not has_table_privilege('anon', 'internal.gift_inflight', 'select'),
  'the runner state is not readable from the API');

select is(
  (select enabled from internal.gift_runner), false,
  'the runner is OFF until a person turns it on');

select is(
  internal.gift_send_next(), 0,
  'and a disabled runner sends nothing');

-- -------------------------------------------------------------- classification
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"ok","message":"ok"}', false, null)),
  'done', 'errorCode ok is a redemption');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E006","message":"x"}', false, null)),
  'already', 'E006 is already redeemed');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E005","message":"x"}', false, null)),
  'expired', 'E005 is expired');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E004","message":"x"}', false, null)),
  'invalid', 'E004 is a code that does not exist');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E009","message":"in cd"}', false, null)),
  'retry', 'E009 (in cd) is try again later');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E007","message":"x"}', false, null)),
  'retry', 'E007 does not retire the code for everyone');
select is(
  (select kind from internal.gift_classify(200, '{"code":10018,"message":"params error"}', false, null)),
  'retry', '10018 is about this player, not a reason to halt');
select is(
  (select kind from internal.gift_classify(200, '{"code":10022,"message":"x"}', false, null)),
  'stop', 'an account alert halts');
select is(
  (select kind from internal.gift_classify(429, '{"errorCode":"ok"}', false, null)),
  'stop', 'a block status halts, whatever the body claims');
select is(
  (select kind from internal.gift_classify(200, '<html>challenge</html>', false, null)),
  'stop', 'an answer that is not JSON halts');
select is(
  (select kind from internal.gift_classify(null, null, true, 'timeout')),
  'retry', 'no answer at all is a retry');
select is(
  (select raw ->> 'errorCode' from internal.gift_classify(200, '{"errorCode":"E999","x":1}', false, null)),
  'E999', 'an unrecognised answer is a retry that keeps the answer verbatim');

-- ------------------------------------------------------------------- settling
insert into public.gift_codes (code_id, code, status) values
  ('00000000-0000-4000-8000-00000000f901', 'RUNNERA', 'unverified'),
  ('00000000-0000-4000-8000-00000000f902', 'RUNNERB', 'unverified');
insert into public.alliances (alliance_id, server_id, external_id, current_name, member_count)
values ('00000000-0000-4000-8000-00000000f911', 580, 'ext-runner', 'RunnerTest', 0);
insert into public.gift_code_claims (claim_id, code_id, alliance_id, game_uid, status, attempt_count, started_at)
values
  ('00000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-00000000f901',
   '00000000-0000-4000-8000-00000000f911', 9530000000000001, 'running', 1, now()),
  ('00000000-0000-4000-8000-00000000fa02', '00000000-0000-4000-8000-00000000f901',
   '00000000-0000-4000-8000-00000000f911', 9530000000000002, 'queued', 0, null),
  ('00000000-0000-4000-8000-00000000fa03', '00000000-0000-4000-8000-00000000f902',
   '00000000-0000-4000-8000-00000000f911', 9530000000000003, 'running', 1, now());

select internal.gift_apply_answer('00000000-0000-4000-8000-00000000fa01', 'done',
                                  '{"errorCode":"ok"}', null);
select is(
  (select status from public.gift_code_claims where claim_id = '00000000-0000-4000-8000-00000000fa01'),
  'done', 'a redemption settles the claim');
select is(
  (select status from public.gift_codes where code_id = '00000000-0000-4000-8000-00000000f901'),
  'working', 'and marks the code as one that works');

select internal.gift_apply_answer('00000000-0000-4000-8000-00000000fa01', 'invalid', '{}', null);
select is(
  (select status from public.gift_code_claims where claim_id = '00000000-0000-4000-8000-00000000fa01'),
  'done', 'settling a claim that is no longer running changes nothing');

-- A dead code retires the code and cancels what waits on it.
update public.gift_code_claims set status = 'running' where claim_id = '00000000-0000-4000-8000-00000000fa02';
select internal.gift_apply_answer('00000000-0000-4000-8000-00000000fa02', 'expired',
                                  '{"errorCode":"E005"}', 'E005');
select is(
  (select status from public.gift_codes where code_id = '00000000-0000-4000-8000-00000000f901'),
  'expired', 'an expired answer retires the code');

-- A retry backs off; the fifth non-answer in a row pauses the runner.
select internal.gift_apply_answer('00000000-0000-4000-8000-00000000fa03', 'retry',
                                  '{"errorCode":"E009"}', 'E009: in cd');
select ok(
  (select status = 'queued' and next_attempt_at > now() + interval '4 minutes'
   from public.gift_code_claims where claim_id = '00000000-0000-4000-8000-00000000fa03'),
  'a retry goes back in the queue, a few minutes out');

-- A stop is not an attempt, and it switches the runner off.
update internal.gift_runner set enabled = true;
update public.gift_code_claims set status = 'running', attempt_count = 2
 where claim_id = '00000000-0000-4000-8000-00000000fa03';
select internal.gift_apply_answer('00000000-0000-4000-8000-00000000fa03', 'stop',
                                  '{"http_status":429}', 'HTTP 429');
select ok(
  (select not enabled and halted_reason = 'HTTP 429' from internal.gift_runner)
  and (select attempt_count = 1 and status = 'queued'
       from public.gift_code_claims where claim_id = '00000000-0000-4000-8000-00000000fa03'),
  'a stop returns the pair untouched and turns the runner off with the reason');

-- ------------------------------------------------------- the officer's switch
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000fb01', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'runner-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000fb02', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'runner-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000fb01', 'member', 'runner member'),
  ('00000000-0000-4000-8000-00000000fb02', 'officer', 'runner officer');
create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000fb01');
select throws_ok($$ select * from public.gift_runner_status() $$, '42501', null,
  'a member cannot read the runner');
select throws_ok($$ select public.set_gift_runner_enabled(true) $$, '42501', null,
  'a member cannot turn it on');

select pg_temp.act_as('00000000-0000-4000-8000-00000000fb02');
select lives_ok($$ select public.set_gift_runner_enabled(true) $$,
  'an officer can turn it on');
select is((select enabled from public.gift_runner_status()), true,
  'and read that it is on');
select public.set_gift_runner_enabled(false);
select is((select halted_reason from public.gift_runner_status()), 'turned off by an officer',
  'turning it off says who did it');
reset role;

select * from finish();
rollback;
