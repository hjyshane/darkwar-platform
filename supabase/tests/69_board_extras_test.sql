-- 0115-0117: comment counts on the list, scrapped posts, and reply alerts.
--
-- Three small features, one file, because they share a fixture and each is
-- only a handful of assertions. The §20.2 negatives are one per feature and
-- they are all the same shape — none of these is alliance-wide data:
--
--   a count of comments you may not read would tell you a draft exists;
--   a scrap is a private shortcut and 0022's policy is the only thing
--     between one member's list and another's;
--   a notification names who answered you, and belongs to nobody else.
--
-- Each negative has a positive beside it (0055), because a view that refuses
-- everybody passes the negative by accident.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a0115', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'extras-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000b0115', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'extras-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000c0115', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'extras-other@test.invalid');

insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000a0115', 'admin', 'TheAdmin'),
  ('00000000-0000-4000-8000-0000000b0115', 'member', 'TheMember'),
  ('00000000-0000-4000-8000-0000000c0115', 'member', 'TheOther');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- One published guide and one draft, so the count can be shown to respect the
-- draft rule it inherits from 0113's read policy.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0115');
insert into public.guides (guide_id, title, body, category, published_at) values
  ('00000000-0000-4000-8000-000000010115', 'Open', 'x', 'tip', now()),
  ('00000000-0000-4000-8000-000000020115', 'Draft', 'x', 'tip', null);

-- ---------------------------------------------------------------------------
-- 0115 — COUNTING WHAT YOU MAY READ
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
insert into public.post_comments (comment_id, guide_id, body) values
  ('00000000-0000-4000-8000-000000030115',
   '00000000-0000-4000-8000-000000010115', 'first'),
  ('00000000-0000-4000-8000-000000040115',
   '00000000-0000-4000-8000-000000010115', 'second');

select is(
  (select comment_count from public.post_comment_counts
    where guide_id = '00000000-0000-4000-8000-000000010115'),
  2::bigint,
  'the board list counts the comments on a post');

-- A tombstone still renders inside the thread so a reply keeps its parent,
-- but "2 comments" that opens onto one and a "Deleted." is a lie.
update public.post_comments set deleted_at = now()
 where comment_id = '00000000-0000-4000-8000-000000040115';

select is(
  (select comment_count from public.post_comment_counts
    where guide_id = '00000000-0000-4000-8000-000000010115'),
  1::bigint,
  'and a removed one stops counting');

-- THE NEGATIVE. The count is `security_invoker`, so it can only count what the
-- reader may read - otherwise it announces that a draft exists.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0115');
insert into public.post_comments (guide_id, body)
values ('00000000-0000-4000-8000-000000020115', 'on the draft');

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
select is(
  (select count(*) from public.post_comment_counts
    where guide_id = '00000000-0000-4000-8000-000000020115'),
  0::bigint,
  'a member gets no count for a draft they cannot open');

select pg_temp.act_as('00000000-0000-4000-8000-0000000a0115');
select is(
  (select comment_count from public.post_comment_counts
    where guide_id = '00000000-0000-4000-8000-000000020115'),
  1::bigint,
  'while somebody who may see the draft gets its real count');

-- ---------------------------------------------------------------------------
-- 0116 — SCRAPPING A POST
-- ---------------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');

select lives_ok(
  $$ insert into public.favourites (user_id, guide_id)
     values ('00000000-0000-4000-8000-0000000b0115',
             '00000000-0000-4000-8000-000000010115') $$,
  'a member scraps a guide');

-- 0022's partial-unique trick, extended. Without it the same post scraps twice
-- and the list shows it twice.
select throws_ok(
  $$ insert into public.favourites (user_id, guide_id)
     values ('00000000-0000-4000-8000-0000000b0115',
             '00000000-0000-4000-8000-000000010115') $$,
  '23505',
  NULL,
  'and cannot scrap the same one twice');

-- The check now names five targets. A row setting two is still one row too
-- many - this is what a second, additive check would have allowed.
select throws_ok(
  $$ insert into public.favourites (user_id, guide_id, server_id)
     values ('00000000-0000-4000-8000-0000000b0115',
             '00000000-0000-4000-8000-000000010115', 580) $$,
  '23514',
  NULL,
  'a favourite still points at exactly one thing');

-- The starred players/alliances/servers this table already held keep working;
-- widening the check must not have narrowed the old targets.
select lives_ok(
  $$ insert into public.favourites (user_id, server_id)
     values ('00000000-0000-4000-8000-0000000b0115', 580) $$,
  'and starring a server still works');

-- THE NEGATIVE. 0022's policy is the only thing between one member's list and
-- another's, and it now covers two more columns without being rewritten.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0115');
select is(
  (select count(*) from public.favourites),
  0::bigint,
  'another member sees none of it');

select throws_ok(
  $$ insert into public.favourites (user_id, guide_id)
     values ('00000000-0000-4000-8000-0000000b0115',
             '00000000-0000-4000-8000-000000010115') $$,
  '42501',
  NULL,
  'nor can they scrap something into somebody else''s list');

-- The positive beside it: the owner still has both rows.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
select is(
  (select count(*) from public.favourites),
  2::bigint,
  'while the owner sees the guide and the server they kept');

-- ---------------------------------------------------------------------------
-- 0117 — A REPLY REACHES ITS AUTHOR
-- ---------------------------------------------------------------------------

-- The other member answers the first comment.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0115');
insert into public.post_comments (comment_id, guide_id, parent_comment_id, body)
values ('00000000-0000-4000-8000-000000050115',
        '00000000-0000-4000-8000-000000010115',
        '00000000-0000-4000-8000-000000030115', 'answering you');

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
select is(
  (select count(*) from public.comment_notifications where read_at is null),
  1::bigint,
  'a reply leaves an unread notification for the comment''s author');

select is(
  (select comment_id from public.comment_notifications),
  '00000000-0000-4000-8000-000000050115'::uuid,
  'pointing at the reply, so the badge can open it');

-- THE NEGATIVE. It names who answered you and belongs to nobody else.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0115');
select is(
  (select count(*) from public.comment_notifications),
  0::bigint,
  'the replier sees nothing - it is not their notification');

-- ANSWERING YOURSELF IS NOT NEWS. Without this every member who continues
-- their own thought gets alerted about it.
select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
insert into public.post_comments (guide_id, parent_comment_id, body)
values ('00000000-0000-4000-8000-000000010115',
        '00000000-0000-4000-8000-000000030115', 'and another thing');

select is(
  (select count(*) from public.comment_notifications),
  1::bigint,
  'and replying to yourself notifies nobody');

-- A top-level comment is not an answer to anything.
select pg_temp.act_as('00000000-0000-4000-8000-0000000c0115');
insert into public.post_comments (guide_id, body)
values ('00000000-0000-4000-8000-000000010115', 'unrelated');

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
select is(
  (select count(*) from public.comment_notifications),
  1::bigint,
  'nor does a new top-level comment');

-- Marking it read is the only write a client gets.
select lives_ok(
  $$ update public.comment_notifications set read_at = now()
      where user_id = '00000000-0000-4000-8000-0000000b0115' $$,
  'the recipient can mark it read');

select is(
  (select count(*) from public.comment_notifications where read_at is null),
  0::bigint,
  'and the badge clears');

-- THE TRIGGER IS THE ONLY WRITER. A client that could insert could fabricate
-- an alert in somebody else's list.
select throws_ok(
  $$ insert into public.comment_notifications (user_id, comment_id)
     values ('00000000-0000-4000-8000-0000000c0115',
             '00000000-0000-4000-8000-000000050115') $$,
  '42501',
  NULL,
  'nobody can write a notification by hand');

-- Dismissing is `read_at`; the row is the record that the reply happened.
select throws_ok(
  $$ delete from public.comment_notifications
      where user_id = '00000000-0000-4000-8000-0000000b0115' $$,
  '42501',
  NULL,
  'and nobody can delete one');

-- A notification about a comment that no longer exists has nothing to open.
--
-- Exercised by deleting the POST, which is the only way a comment is really
-- hard-deleted: `authenticated` holds no DELETE grant on post_comments at all
-- (0113), so this walks the whole chain the alliance can actually trigger —
-- guide.delete removes the guide, which cascades to its comments, which
-- cascade to the notifications about them.
select pg_temp.act_as('00000000-0000-4000-8000-0000000a0115');
delete from public.guides
 where guide_id = '00000000-0000-4000-8000-000000010115';

select pg_temp.act_as('00000000-0000-4000-8000-0000000b0115');
select is(
  (select count(*) from public.comment_notifications),
  0::bigint,
  'and deleting the post takes the thread and its notifications with it');

-- The scrap of that guide goes too, which is 0022's reason for real foreign
-- keys and why 0116 reused the table rather than inventing a post_id column.
select is(
  (select count(*) from public.favourites where guide_id is not null),
  0::bigint,
  'along with anybody''s scrap of it');

reset role;

select * from finish();
rollback;
