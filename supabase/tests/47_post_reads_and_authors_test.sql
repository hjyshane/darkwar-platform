-- 0079: read marks are private, and an author name exposes as little as it can.
--
-- The read table's negative test is not about secrecy for its own sake. "Who has
-- read my notice" is a question this schema refuses to answer, because answering
-- it turns a reading aid into surveillance — and an officer asking a member why
-- they had not opened a guide is not what the column is for.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000ad079', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reads-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000be079', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reads-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce079', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reads-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000de079', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reads-nobody@test.invalid');

-- The admin is linked to a character, so the author view has a name to show.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000cb791', 580, 9900000000000001, 'TheWriter');

insert into public.app_users (user_id, role, player_id) values
  ('00000000-0000-4000-8000-0000000ad079', 'admin',
   '00000000-0000-4000-8000-0000000cb791'),
  ('00000000-0000-4000-8000-0000000be079', 'member', null),
  ('00000000-0000-4000-8000-0000000ce079', 'member', null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- INSERTED AS THE AUTHOR, not seeded with a created_by column. 0078's trigger
-- sets `created_by := auth.uid()` on insert and pins it to the old value on
-- update, so a seeded value becomes null and an update cannot put it back. That
-- is the trigger working — an author field the author can write is not an author
-- field — and it means a fixture that needs an author has to act as one.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad079');
insert into public.guides (title, body, category, published_at) values
  ('Arena line-ups', 'Tanks first.', 'strategy', now());

-- ------------------------------------------------------------------ read marks
select pg_temp.act_as('00000000-0000-4000-8000-0000000be079');

select lives_ok(
  $$ insert into public.post_reads (user_id, guide_id)
     select (select auth.uid()), guide_id from public.guides limit 1 $$,
  'a member can mark a guide read');

select is(
  (select count(*) from public.post_reads),
  1::bigint,
  'and sees their own mark');

-- Marking somebody ELSE as having read something would let one account fill in
-- another's history, which is the same fault as writing to their favourites.
select throws_ok(
  $$ insert into public.post_reads (user_id, guide_id)
     select '00000000-0000-4000-8000-0000000ce079', guide_id from public.guides limit 1 $$,
  '42501',
  NULL,
  'but cannot mark one read on somebody else''s behalf');

-- The privacy half. A second member sees nothing of the first one's reading.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce079');
select is(
  (select count(*) from public.post_reads),
  0::bigint,
  'another member cannot see who has read what — that question stays unanswerable');

-- Not even an admin. Deliberate: there is no legitimate use for it that is worth
-- the one it would be used for.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ad079');
select is(
  (select count(*) from public.post_reads),
  0::bigint,
  'nor an admin');

-- Reading the same post twice is one mark, not two.
select pg_temp.act_as('00000000-0000-4000-8000-0000000be079');
select throws_ok(
  $$ insert into public.post_reads (user_id, guide_id)
     select (select auth.uid()), guide_id from public.guides limit 1 $$,
  '23505',
  NULL,
  'and a second mark for the same guide is refused');

-- Exactly one target. A row naming both a guide and a notice would be read as
-- whichever column the query happened to filter on.
select throws_ok(
  $$ insert into public.post_reads (user_id, guide_id, announcement_id)
     values ((select auth.uid()),
             (select guide_id from public.guides limit 1),
             gen_random_uuid()) $$,
  '23514',
  NULL,
  'a row cannot name two posts at once');

select lives_ok(
  $$ delete from public.post_reads where user_id = (select auth.uid()) $$,
  'and a member can clear their own marks');

-- --------------------------------------------------------------- author names
select is(
  (select display_name from public.post_authors
    where user_id = '00000000-0000-4000-8000-0000000ad079'),
  'TheWriter',
  'a member sees the author''s game name, not their email');

-- The narrowing. Two members exist with no writing to their name; neither should
-- appear, because the view's justification is "you may see who wrote what you are
-- reading" and nothing more.
select is(
  (select count(*) from public.post_authors),
  1::bigint,
  'and only people who have actually written something appear at all');

-- Somebody signed in with no app_users row is not in the alliance.
select pg_temp.act_as('00000000-0000-4000-8000-0000000de079');
select is(
  (select count(*) from public.post_authors),
  0::bigint,
  'somebody with no app_users row sees no authors');

select is(
  (select count(*) from public.post_reads),
  0::bigint,
  'and no read marks');

reset role;

select * from finish();
rollback;
