-- 0078: who reads a guide, who reads a draft, and who can write one.
--
-- The draft rule is the one worth testing hardest. A draft is unfinished writing
-- about alliance strategy, and the whole reason publishing is a separate step is
-- that publishing posts to Discord — so a draft leaking to 94 members would
-- defeat the step rather than merely embarrass its author.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad078', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guide-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be078', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guide-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce078', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guide-officer@test.invalid'),
  -- Signed in, no app_users row: what a stranger who found the URL looks like.
  ('00000000-0000-4000-8000-0000000de078', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guide-nobody@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000ad078', 'admin'),
  ('00000000-0000-4000-8000-0000000be078', 'member'),
  ('00000000-0000-4000-8000-0000000ce078', 'officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- No explicit ids: every assertion below finds its row by title, and a
-- hand-written uuid is one 'g' away from failing the whole file before the plan
-- runs. It was.
insert into public.guides (title, body, category, published_at) values
  ('Arena line-ups', 'Put tanks first.', 'strategy', now()),
  ('Half-written', 'TODO', 'tip', null);

set local role authenticated;

-- ------------------------------------------------------------------ the member
select pg_temp.act_as('00000000-0000-4000-8000-0000000be078');
select is(
  (select count(*) from public.guides),
  1::bigint,
  'a member reads the published guide and not the draft');
select is(
  (select title from public.guides),
  'Arena line-ups',
  'and it is the published one');

-- A member cannot write. This is the capability half, and it is the switch an
-- alliance might change its mind about later.
select throws_ok(
  $$ insert into public.guides (title, body) values ('mine', 'x') $$,
  '42501',
  NULL,
  'and cannot write one');

-- ----------------------------------------------------------------- the officer
-- The reason the board exists: the people who know how events work are R4s, and
-- routing every tip through an admin is how a board stays empty.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce078');
select is(
  (select count(*) from public.guides),
  2::bigint,
  'an officer sees the draft too, because they may write');

select lives_ok(
  $$ insert into public.guides (title, body, category) values ('Mine', 'x', 'tip') $$,
  'an officer can write a guide');

select lives_ok(
  $$ update public.guides set body = 'Put tanks first, always.'
     where title = 'Arena line-ups' $$,
  'and edit somebody else''s — a wrong guide should be fixable by whoever reads it');

-- Deleting is not symmetric with editing, deliberately. An edit leaves the
-- mistake visible while it lasts and the next officer can undo it; a delete
-- leaves nothing, and this table keeps no history.
--
-- Asserted as SURVIVAL, not as an error. A DELETE that no `using` clause admits
-- removes nothing and raises nothing — RLS filters it, and 42501 comes only from
-- a missing GRANT, which `authenticated` has. Expecting the error passed for the
-- wrong reason nowhere and failed here, which is the better outcome: the thing
-- worth testing is that the guide is still there afterwards.
delete from public.guides where title = 'Arena line-ups';
select is(
  (select count(*) from public.guides where title = 'Arena line-ups'),
  1::bigint,
  'but cannot delete one — the irreversible verb keeps the narrower role');

-- ------------------------------------------------------------------- the actor
-- 0033's rule, and the third table to need it: an author field the author can
-- write is not an author field.
select is(
  (select created_by from public.guides where title = 'Mine'),
  '00000000-0000-4000-8000-0000000ce078'::uuid,
  'the author is stamped from the session, not sent by the client');

update public.guides set created_by = '00000000-0000-4000-8000-0000000be078'
where title = 'Mine';
select is(
  (select created_by from public.guides where title = 'Mine'),
  '00000000-0000-4000-8000-0000000ce078'::uuid,
  'and an update cannot reassign it');

-- ------------------------------------------------------------------- the admin
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad078');
select lives_ok(
  $$ delete from public.guides where title = 'Mine' $$,
  'an admin can delete');

-- ---------------------------------------------------------------- the outsider
select pg_temp.act_as('00000000-0000-4000-8000-0000000de078');
select is(
  (select count(*) from public.guides),
  0::bigint,
  'somebody with no app_users row reads nothing, published or not');
select throws_ok(
  $$ insert into public.guides (title, body) values ('theirs', 'x') $$,
  '42501',
  NULL,
  'and writes nothing');

reset role;

-- --------------------------------------------------------------- the categories
-- Checked rather than free text: two people would write 'strategy' and
-- 'Strategy' inside a week and the board would sort into two piles.
select throws_ok(
  $$ insert into public.guides (title, category) values ('bad', 'Strategy') $$,
  '23514',
  NULL,
  'a category outside the three named ones is refused');

-- Every capability a policy names has to be in the registry, or the policy reads
-- as "denied" and looks exactly like working correctly (0045).
select is(
  (select count(*) from public.capabilities
    where capability in ('guide.write', 'guide.edit', 'guide.delete')),
  3::bigint,
  'and the three new capabilities are registered');

select * from finish();
rollback;
