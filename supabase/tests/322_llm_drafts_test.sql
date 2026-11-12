-- 0322: llm_digest_facts and llm_drafts.
--
-- Pinned: the FACTS are what a rank period says (tiers, changes, growth, moves) and
-- are read through the caller's role; a member and an anonymous caller are refused
-- (negative tests, spec 20.2). The DRAFTS are officer-only, insert-only for the model
-- path (status and output cannot be set or rewritten), decided exactly once, and an
-- alliance other than the one being viewed is invisible.
--
-- Fixed dates throughout; nothing here depends on the day the suite runs.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad322', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'llm-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000be322', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'llm-member@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad322', 'officer'),
  ('00000000-0000-4000-8000-0000000be322', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- One own alliance by rule, and a second one that must stay invisible.
update public.alliances set is_own = false, roster_unredacted_seen = false
where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own) values
  ('00000000-0000-4000-8000-0000000ab322', 580, 'ext-llm-a', 'LlmA', true),
  ('00000000-0000-4000-8000-0000000bb322', 581, 'ext-llm-b', 'LlmB', false);

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id) values
  ('00000000-0000-4000-8000-000000cb3221', 580, 9322000000000001, 'Alice', '00000000-0000-4000-8000-0000000ab322'),
  ('00000000-0000-4000-8000-000000cb3222', 580, 9322000000000002, 'Bob',   '00000000-0000-4000-8000-0000000ab322'),
  ('00000000-0000-4000-8000-000000cb3223', 580, 9322000000000003, 'Cara',  '00000000-0000-4000-8000-0000000ab322');

-- Previous period: everyone R3 except Cara R2. Current: Alice R3, Bob R2 (score), Cara R1 (offline).
insert into public.rank_period_snapshots
  (period_start, period_end, player_id, game_uid, name, alliance_id, tier, tier_reason, power_growth)
values
  ('2026-10-12 02:00+00', '2026-10-26 02:00+00', '00000000-0000-4000-8000-000000cb3221', 9322000000000001, 'Alice', '00000000-0000-4000-8000-0000000ab322', 'R3', 'score', 10),
  ('2026-10-12 02:00+00', '2026-10-26 02:00+00', '00000000-0000-4000-8000-000000cb3222', 9322000000000002, 'Bob',   '00000000-0000-4000-8000-0000000ab322', 'R3', 'score', 20),
  ('2026-10-12 02:00+00', '2026-10-26 02:00+00', '00000000-0000-4000-8000-000000cb3223', 9322000000000003, 'Cara',  '00000000-0000-4000-8000-0000000ab322', 'R2', 'score', 30),
  ('2026-10-26 02:00+00', '2026-11-09 02:00+00', '00000000-0000-4000-8000-000000cb3221', 9322000000000001, 'Alice', '00000000-0000-4000-8000-0000000ab322', 'R3', 'score', 500),
  ('2026-10-26 02:00+00', '2026-11-09 02:00+00', '00000000-0000-4000-8000-000000cb3222', 9322000000000002, 'Bob',   '00000000-0000-4000-8000-0000000ab322', 'R2', 'score', 100),
  ('2026-10-26 02:00+00', '2026-11-09 02:00+00', '00000000-0000-4000-8000-000000cb3223', 9322000000000003, 'Cara',  '00000000-0000-4000-8000-0000000ab322', 'R1', 'offline', 300);

insert into public.player_server_moves
  (player_id, game_uid, from_server_id, to_server_id, seen_at, source_command)
values
  ('00000000-0000-4000-8000-000000cb3222', 9322000000000002, 580, 581, '2026-11-02 12:00+00', 'test');

-- ---------------------------------------------------------------- the facts
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad322');

select lives_ok($$ select public.llm_digest_facts('2026-10-26 02:00+00') $$,
  'an officer can read the digest facts');

create temp table f on commit drop as
  select public.llm_digest_facts('2026-10-26 02:00+00') as j;
grant select on f to authenticated;

select is((select (j->>'member_count')::int from f), 3, 'three members in the period');
select is((select j->'tiers' from f), '{"R1": 1, "R2": 1, "R3": 1}'::jsonb, 'tier counts');
select is((select (j->>'offline_demotions')::int from f), 1, 'one member sent to R1 by the offline rule');
select is((select (j->'tier_changes'->>'count')::int from f), 2,
  'Bob and Cara changed tier; Alice did not');
select is((select j->'tier_changes'->'items'->0->>'name' from f), 'Bob', 'changes are listed by name');
select is((select j->'top_power_growth'->0->>'name' from f), 'Alice', 'growth leader first');
select is((select (j->'server_moves'->>'count')::int from f), 1, 'one server move inside the period');

-- ---------------------------------------------------------------- the gate (negative)
select pg_temp.act_as('00000000-0000-4000-8000-0000000be322');
select throws_ok($$ select public.llm_digest_facts('2026-10-26 02:00+00') $$,
  '42501', null, 'a member is refused the facts');
reset role;
set local role anon;
select throws_ok($$ select public.llm_digest_facts('2026-10-26 02:00+00') $$,
  '42501', null, 'an anonymous caller is refused the facts');
reset role;

-- ---------------------------------------------------------------- the drafts
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad322');

select lives_ok($$
  insert into public.llm_drafts (kind, period_start, facts, facts_hash, prompt_version, model, output)
  values ('weekly_digest', '2026-10-26 02:00+00', '{"facts_version":1}'::jsonb, 'h1', 'p1', 'm1', 'hello')
$$, 'an officer can store a draft');
select is((select count(*)::int from public.llm_drafts), 1, 'and read it back');

select throws_ok($$
  insert into public.llm_drafts (kind, facts, facts_hash, prompt_version, model, output, status)
  values ('weekly_digest', '{}'::jsonb, 'h2', 'p1', 'm1', 'x', 'approved')
$$, '42501', null, 'status cannot be set on insert');
select throws_ok($$ update public.llm_drafts set output = 'rewritten' $$,
  '42501', null, 'the model''s output is never rewritten');

select lives_ok($$ update public.llm_drafts set status = 'approved', final_text = 'edited' $$,
  'an officer decides the draft once');
select is((select decided_by from public.llm_drafts),
  '00000000-0000-4000-8000-0000000ad322'::uuid, 'and the decision is stamped with who');
select throws_ok($$ update public.llm_drafts set status = 'discarded' $$,
  '23514', null, 'a decided draft cannot be decided again');

-- A member sees none of it; another alliance's draft is invisible to an officer.
reset role;
insert into public.llm_drafts (alliance_id, kind, facts, facts_hash, prompt_version, model, output, created_by)
values ('00000000-0000-4000-8000-0000000bb322', 'weekly_digest', '{}'::jsonb, 'hb', 'p1', 'm1', 'other',
  '00000000-0000-4000-8000-0000000ad322');
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad322');
select is((select count(*)::int from public.llm_drafts where output = 'other'), 0,
  'a draft of another alliance is invisible to an officer viewing this one');
select pg_temp.act_as('00000000-0000-4000-8000-0000000be322');
select is((select count(*)::int from public.llm_drafts), 0, 'a member sees no drafts at all');

select * from finish();
rollback;
