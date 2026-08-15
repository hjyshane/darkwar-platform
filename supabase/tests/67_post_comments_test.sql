-- 0113: who may read a comment, who may write one, and how deep a thread goes.
--
-- The negative case §20.2 asks for is the first one below, and it is the one
-- that matters: a comment inherits the visibility of the post it hangs off, so
-- a draft's thread must be as invisible as the draft. The read policy says that
-- by REFERENCE — `exists (select 1 from guides …)` under the reader's own RLS —
-- rather than by restating 0078 and 0108's rules, and the whole point of that
-- choice is that it cannot drift. This file is what proves the reference works.
--
-- Positives sit beside every negative on purpose. 0055's lesson: a policy that
-- refuses everybody passes a negative test by accident, and a comment thread
-- nobody can read would look exactly like a comment thread that is properly
-- secured.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-officer@test.invalid'),
  ('00000000-0000-4000-8000-0000000c0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000d0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000e0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-viewer@test.invalid'),
  -- Signed in, but never admitted: no `app_users` row at all. Not the same
  -- person as the viewer, who has been admitted and given nothing.
  ('00000000-0000-4000-8000-0000000f0113', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comments-stranger@test.invalid');

-- The commenter is linked to a character. This is the case the whole naming
-- decision exists for: the alliance knows this person as Scout, not as an
-- email address, and a rename in the game has to reach the board on its own.
insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-000000010113', 580, 9900000000000113, 'Scout');

insert into public.app_users (user_id, role, player_id, display_name) values
  ('00000000-0000-4000-8000-0000000a0113', 'admin', null, 'TheAdmin'),
  ('00000000-0000-4000-8000-0000000b0113', 'officer', null, 'TheOfficer'),
  ('00000000-0000-4000-8000-0000000c0113', 'member',
   '00000000-0000-4000-8000-000000010113', 'not-the-character'),
  ('00000000-0000-4000-8000-0000000d0113', 'member', null, 'TheOther'),
  ('00000000-0000-4000-8000-0000000e0113', 'viewer', null, 'TheViewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- The posts. Written as the admin, because 0078's actor trigger sets
-- `created_by` from `auth.uid()` and a seeded value would be discarded.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0113');

insert into public.guides (guide_id, title, body, category, published_at) values
  ('00000000-0000-4000-8000-000000020113', 'Arena line-ups', 'Tanks first.',
   'strategy', now()),
  ('00000000-0000-4000-8000-000000030113', 'Half a thought', 'TODO', 'tip', null);

insert into public.announcements
  (announcement_id, title, body, visibility, published_at) values
  ('00000000-0000-4000-8000-000000040113', 'Rally Saturday', 'Be online.',
   'member', now());

-- ---------------------------------------------------------------------------
-- READING FOLLOWS THE POST
-- ---------------------------------------------------------------------------

-- A comment on the published guide, by a member.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');
select lives_ok(
  $$ insert into public.post_comments (comment_id, guide_id, body)
     values ('00000000-0000-4000-8000-000000050113',
             '00000000-0000-4000-8000-000000020113', 'Which tank?') $$,
  'a member can comment on a published guide');

-- 0033's rule again: the author is who they are, not what they typed.
select is(
  (select author_user_id from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  '00000000-0000-4000-8000-0000000c0113'::uuid,
  'and the comment is credited to the account that wrote it');

-- THE NEGATIVE §20.2 ASKS FOR. A draft's comments are as invisible as the
-- draft. Written by the admin, who may see the draft; read by a member, who
-- may not.
reset role;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0113');
insert into public.post_comments (comment_id, guide_id, body)
values ('00000000-0000-4000-8000-000000080113',
        '00000000-0000-4000-8000-000000030113', 'Not ready yet.');

select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');
select is(
  (select count(*) from public.post_comments
    where guide_id = '00000000-0000-4000-8000-000000030113'),
  0::bigint,
  'a member cannot read the comments on a draft they cannot open');

-- And the positive beside it, so the policy is not passing by refusing
-- everybody: the same member reads the published guide''s thread.
select is(
  (select count(*) from public.post_comments
    where guide_id = '00000000-0000-4000-8000-000000020113'),
  1::bigint,
  'but does read the comments on the published guide');

-- Whoever may see the draft sees its thread. `guide.write` is the draft
-- reader on 0078, and the officer has it.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0113');
select is(
  (select count(*) from public.post_comments
    where guide_id = '00000000-0000-4000-8000-000000030113'),
  1::bigint,
  'somebody who may write guides reads the draft''s comments');

-- A viewer has not been admitted. Guides are member-and-above by role (0078),
-- so their comments are too.
select pg_temp.act_as('00000000-0000-4000-8000-0000000e0113');
select is(
  (select count(*) from public.post_comments),
  0::bigint,
  'a viewer reads no comments at all');

select throws_ok(
  $$ insert into public.post_comments (guide_id, body)
     values ('00000000-0000-4000-8000-000000020113', 'let me in') $$,
  '42501',
  NULL,
  'and cannot write one');

-- ---------------------------------------------------------------------------
-- REPLIES, ONE LEVEL DEEP
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000d0113');
select lives_ok(
  $$ insert into public.post_comments (comment_id, guide_id, parent_comment_id, body)
     values ('00000000-0000-4000-8000-000000060113',
             '00000000-0000-4000-8000-000000020113',
             '00000000-0000-4000-8000-000000050113', 'The frontline one.') $$,
  'a member can reply to a comment');

-- The rule the boards are narrow enough to need. Enforced in the database
-- rather than in the composer, because the composer is one writer of two and
-- the other one is this file.
select throws_ok(
  $$ insert into public.post_comments (guide_id, parent_comment_id, body)
     values ('00000000-0000-4000-8000-000000020113',
             '00000000-0000-4000-8000-000000060113', 'and another thing') $$,
  '23514',
  NULL,
  'but not to a reply — threads stop at one level');

-- A reply belongs to the post its parent is on. Without this a thread can be
-- split across two posts, and each half renders as an answer to nothing.
select throws_ok(
  $$ insert into public.post_comments (announcement_id, parent_comment_id, body)
     values ('00000000-0000-4000-8000-000000040113',
             '00000000-0000-4000-8000-000000050113', 'wrong board') $$,
  '23514',
  NULL,
  'and a reply cannot hang off a comment on a different post');

-- Exactly one target, the same check `post_reads` carries (0079).
select throws_ok(
  $$ insert into public.post_comments (guide_id, announcement_id, body)
     values ('00000000-0000-4000-8000-000000020113',
             '00000000-0000-4000-8000-000000040113', 'both at once') $$,
  '23514',
  NULL,
  'a comment belongs to one post, not two');

select throws_ok(
  $$ insert into public.post_comments (guide_id, body)
     values ('00000000-0000-4000-8000-000000020113', '   ') $$,
  '23514',
  NULL,
  'and an empty one is not a comment');

-- ---------------------------------------------------------------------------
-- EDITING AND REMOVING
-- ---------------------------------------------------------------------------

-- Somebody else's comment is not yours to change.
--
-- ASSERTED ON THE ROW, NOT ON AN EXCEPTION. An UPDATE whose USING clause
-- matches nothing does not raise — it reports zero rows and returns, so a
-- `throws_ok` here would pass whether or not the policy existed. What the
-- policy actually promises is that the words do not change.
update public.post_comments set body = 'I never said that'
 where comment_id = '00000000-0000-4000-8000-000000050113';

select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');
select is(
  (select body from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  'Which tank?',
  'a member cannot edit somebody else''s comment');

select lives_ok(
  $$ update public.post_comments set body = 'Which tank goes first?'
      where comment_id = '00000000-0000-4000-8000-000000050113' $$,
  'but can edit their own');

select is(
  (select body from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  'Which tank goes first?',
  'and the edit lands');

-- MODERATION IS KEYED TO THE BOARD. The officer may write and edit guides
-- (0078's seed) but deleting stays with admins, so this must fail.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0113');
update public.post_comments set deleted_at = now()
 where comment_id = '00000000-0000-4000-8000-000000050113';

select is(
  (select deleted_at from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  null::timestamptz,
  'an officer without guide.delete cannot remove a member''s comment');

-- The moderator, who may. Asked to rewrite the body in the SAME statement, so
-- that the two halves of the promise are tested where they could conflict:
-- the removal lands and the words do not move. RLS cannot restrict an UPDATE
-- to one column, so this is the actor trigger's pin doing the work — without
-- it a `guide.delete` holder could rewrite a member's words and leave them
-- signed with that member's name.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0113');
select lives_ok(
  $$ update public.post_comments
        set deleted_at = now(), body = 'moderator rewrote this'
      where comment_id = '00000000-0000-4000-8000-000000050113' $$,
  'somebody who may delete guides can remove a comment on one');

select is(
  (select body from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  'Which tank goes first?',
  'and cannot rewrite it on the way past');

-- SOFT DELETE KEEPS THE THREAD. The reply is still there, still attached, and
-- still readable — which is the entire reason `deleted_at` exists rather than
-- a DELETE.
select is(
  (select parent_comment_id from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000060113'),
  '00000000-0000-4000-8000-000000050113'::uuid,
  'a removed comment keeps its replies attached');

select isnt(
  (select deleted_at from public.post_comments
    where comment_id = '00000000-0000-4000-8000-000000050113'),
  null::timestamptz,
  'and is marked removed rather than erased');

-- Nobody signed in may erase one. The soft-delete rule is not a convention
-- the client is trusted to follow.
select throws_ok(
  $$ delete from public.post_comments
      where comment_id = '00000000-0000-4000-8000-000000060113' $$,
  '42501',
  NULL,
  'and no signed-in role can hard-delete a comment');

-- ---------------------------------------------------------------------------
-- THE NAME IS THE CHARACTER
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');

-- The widening 0113 made. This member has never written a guide or a notice —
-- only a comment — and before 0113 they were not in the view at all, which is
-- most of the people whose names a comment thread has to print.
select is(
  (select display_name from public.post_authors
    where user_id = '00000000-0000-4000-8000-0000000c0113'),
  'Scout',
  'a commenter who has never posted is named by their character');

-- The character, not the account's display name, and not stored on the row:
-- a rename in the game reaches every comment they have ever written.
reset role;
update public.players set current_name = 'Scoutmaster'
 where player_id = '00000000-0000-4000-8000-000000010113';
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');

select is(
  (select display_name from public.post_authors
    where user_id = '00000000-0000-4000-8000-0000000c0113'),
  'Scoutmaster',
  'and a rename in the game follows them onto the board');

-- Nobody unnamed. 0113 dropped 'Unknown member': the board prints a dash, and
-- the view says null so that each surface can.
reset role;
update public.app_users set display_name = null
 where user_id = '00000000-0000-4000-8000-0000000d0113';
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');

select is(
  (select display_name from public.post_authors
    where user_id = '00000000-0000-4000-8000-0000000d0113'),
  null::text,
  'a commenter with no character and no display name is left unnamed');

-- ---------------------------------------------------------------------------
-- THE POST OWNS ITS THREAD
-- ---------------------------------------------------------------------------

-- 0079's reason for real foreign keys, which is why this table is not a
-- `board` string beside a bare uuid: deleting the post takes the thread.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');
select is(
  (select count(*) from public.post_comments
    where guide_id = '00000000-0000-4000-8000-000000020113'),
  2::bigint,
  'the published guide has its comment and its reply');

reset role;
delete from public.guides where guide_id = '00000000-0000-4000-8000-000000020113';
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0113');

select is(
  (select count(*) from public.post_comments
    where guide_id = '00000000-0000-4000-8000-000000020113'),
  0::bigint,
  'and deleting it takes both with it, rather than orphaning them');

-- Somebody signed in with no app_users row is not in the alliance.
reset role;
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000f0113');
select is(
  (select count(*) from public.post_comments),
  0::bigint,
  'somebody with no app_users row reads no comments');

reset role;

select * from finish();
rollback;
