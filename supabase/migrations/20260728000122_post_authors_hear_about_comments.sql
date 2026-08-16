-- 0122: the person who wrote the post hears about it too.
--
-- 0117 told you when somebody answered YOUR COMMENT. It said nothing when
-- somebody commented on YOUR POST — which is the more common thing by far, and
-- the one an author actually wants to know about. Somebody writes a guide,
-- three people ask questions under it, and the author finds out by wandering
-- back to the board.
--
-- ONE TRIGGER, TWO CASES, rather than a second trigger beside the first. Both
-- answer "who should be told about this comment", and splitting them would mean
-- two functions racing to insert into the same table with the same conflict
-- rule — and a reply to a comment on your own post would fire both.
--
--   a REPLY tells the parent comment's author (0117, unchanged)
--   a TOP-LEVEL comment tells the post's author (new)
--
-- A reply never tells the post's author. That was a real choice: on a busy
-- guide the author would otherwise be told about every message in every thread,
-- which is how a notification badge becomes something people learn to ignore.
-- The thread's own participants already get told by the 0117 half.
create or replace function public.notify_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient uuid;
begin
  if new.parent_comment_id is not null then
    -- A reply: the person being answered.
    select author_user_id into recipient from public.post_comments
     where comment_id = new.parent_comment_id;
  elsif new.guide_id is not null then
    select created_by into recipient from public.guides
     where guide_id = new.guide_id;
  else
    select created_by into recipient from public.announcements
     where announcement_id = new.announcement_id;
  end if;

  -- Nobody to tell: the post predates `created_by`, or it is the commenter's
  -- own. Talking to yourself is not news, and it is the case that would
  -- otherwise fire on every draft an author comments on while writing it.
  if recipient is null or recipient = new.author_user_id then
    return null;
  end if;

  -- AND THE RECIPIENT HAS TO STILL BE A MEMBER. This is not defensive coding;
  -- without it, commenting on a post by a departed member FAILS THE COMMENT.
  --
  -- The two columns do not decay together. `post_comments.author_user_id`
  -- references `app_users` and 0094 made it `set null`, so 0117's reply path
  -- goes quiet on its own when somebody leaves. But `guides.created_by` and
  -- `announcements.created_by` reference `auth.users`, and `remove_member()`
  -- deletes only the `app_users` row — the auth row survives, so `created_by`
  -- stays populated and points at somebody who is no longer a member.
  --
  -- `comment_notifications.user_id` references `app_users`. Inserting that
  -- uuid raises a foreign key violation inside an AFTER INSERT trigger, which
  -- takes the whole statement down: the member would be told their comment
  -- failed, on a post they had nothing to do with.
  if not exists (select 1 from public.app_users where user_id = recipient) then
    return null;
  end if;

  -- ON CONFLICT still matters, and now for a second reason. The unique key is
  -- (user_id, comment_id), so an author who is ALSO the parent comment's
  -- author cannot be told twice about one comment.
  insert into public.comment_notifications (user_id, comment_id)
  values (recipient, new.comment_id)
  on conflict (user_id, comment_id) do nothing;

  return null;
end;
$$;

comment on function public.notify_comment_reply() is
  'Who to tell about a new comment: a reply tells the parent comment''s '
  'author, a top-level comment tells the post''s author. A reply deliberately '
  'does NOT tell the post''s author — on a busy guide that is every message in '
  'every thread, which is how a badge becomes noise.';


-- ---------------------------------------------------------------------------
-- AND A BUG 0113 SHIPPED, FOUND BY THE TEST ABOVE.
-- ---------------------------------------------------------------------------
--
-- `remove_member()` fails for anybody who has ever commented.
--
-- `post_comments.author_user_id` is `references app_users on delete set null`,
-- and that action is performed as an UPDATE on `post_comments`. The UPDATE
-- fires `post_comments_set_actor`, whose whole job is to pin the author so a
-- client cannot rewrite it — and it pins the cascade too, putting back the
-- uuid the delete was in the middle of removing. The foreign key then refuses
-- the row it just tried to fix, and the delete aborts.
--
-- Nobody had hit it because 0113 shipped hours ago and nobody has been removed
-- since. The 0122 test that removes an author to check the notification guard
-- is what walked into it.
--
-- THE FIX IS NARROW ON PURPOSE. The pin is the reason the trigger exists
-- (0033: an author field the author can write is not an author field), so it
-- stays for every case except the one the database itself performs: nulling
-- the column for a member whose `app_users` row is already gone. A client
-- cannot reach that state — their own row exists while they are calling.
create or replace function public.post_comments_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_user_id := auth.uid();
    new.deleted_at := null;
    return new;
  end if;

  -- The `on delete set null` cascade, and only it: the author is being nulled
  -- and the account it named is already gone from app_users. Let it through.
  if not (
    new.author_user_id is null
    and old.author_user_id is not null
    and not exists (
      select 1 from public.app_users where user_id = old.author_user_id
    )
  ) then
    new.author_user_id := old.author_user_id;
  end if;

  new.created_at := old.created_at;
  new.guide_id := old.guide_id;
  new.announcement_id := old.announcement_id;

  -- A moderator may remove, not rewrite. The author may do both.
  if old.author_user_id is distinct from auth.uid() then
    new.body := old.body;
    new.parent_comment_id := old.parent_comment_id;
  end if;

  return new;
end;
$$;
