-- 0117: somebody answered you, and you would otherwise never know.
--
-- A reply is the one thing on these boards written AT a specific person. The
-- read marks (0079) tell you a post is new; nothing tells you that the
-- question you asked under it has an answer, and a member who does not
-- re-open every post they have ever commented on simply never finds out.
--
-- A TABLE RATHER THAN A DERIVED QUERY, and the deciding reason is that unread
-- is per-notification. The cheap alternative is one "last checked" timestamp
-- per member and a live query for replies newer than it — no rows written per
-- event — but then reading one reply marks every reply read, and a member with
-- three answers who opens one loses the other two. A count that can say "2"
-- and then "1" needs somewhere to record which one was dealt with.
create table public.comment_notifications (
  notification_id uuid primary key default gen_random_uuid(),

  -- WHO IS BEING TOLD: the author of the parent comment. Not "the author of
  -- the post" — that is a different feature and would fire on every comment
  -- rather than on an answer to something you said.
  user_id uuid not null references public.app_users (user_id) on delete cascade,

  -- The reply itself. Cascade, because a notification about a comment that no
  -- longer exists has nothing to open.
  comment_id uuid not null references public.post_comments (comment_id) on delete cascade,

  created_at timestamptz not null default now(),

  -- Null is unread. A timestamp rather than a boolean for the usual reason:
  -- "when did they see it" is free here and answers questions a flag cannot.
  read_at timestamptz,

  -- One notification per reply. The trigger below fires once per row, but an
  -- edit to a reply must not mint a second one.
  constraint comment_notifications_once unique (user_id, comment_id)
);

comment on table public.comment_notifications is
  'One row per reply to your comment. Written by trigger, read only by its '
  'recipient. Deleting the reply removes it — a notification that opens onto '
  'nothing is worse than no notification.';

-- The unread badge is the only read path that matters, and it asks one
-- question: what is unread for me, newest first.
create index comment_notifications_unread_idx
  on public.comment_notifications (user_id, created_at desc) where read_at is null;

-- WRITTEN BY TRIGGER, NOT BY THE CLIENT.
--
-- The client that inserts the reply is the WRONG writer twice over: it would
-- have to know the parent's author, which RLS may well hide from it, and a
-- client that simply declines to send the notification silences somebody
-- else's alert. Making it a consequence of the insert means it cannot be
-- opted out of.
--
-- DEFINER because it reads the parent comment and writes a row owned by
-- somebody else — both are things the replier's own policies forbid, and
-- correctly so.
create function public.notify_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_author uuid;
begin
  if new.parent_comment_id is null then
    return null;
  end if;

  select author_user_id into parent_author
    from public.post_comments
   where comment_id = new.parent_comment_id;

  -- Nobody to tell: the parent's author has left the alliance (0094 nulls the
  -- column) or is the person replying. Answering yourself is not news.
  if parent_author is null or parent_author = new.author_user_id then
    return null;
  end if;

  insert into public.comment_notifications (user_id, comment_id)
  values (parent_author, new.comment_id)
  on conflict (user_id, comment_id) do nothing;

  return null;
end;
$$;

-- AFTER INSERT ONLY. An edit to a reply is not a new answer, and firing on
-- update would re-alert somebody every time a typo was fixed.
create trigger post_comments_notify_reply
  after insert on public.post_comments
  for each row execute function public.notify_comment_reply();

alter table public.comment_notifications enable row level security;

-- Read your own, and mark them read. No INSERT: the trigger is the only
-- writer, and a client that could insert could fabricate an alert in somebody
-- else's list. No DELETE: dismissing is `read_at`, and the row is the record
-- that the reply happened.
grant select, update on public.comment_notifications to authenticated;
grant all on public.comment_notifications to service_role;

create policy own_notifications on public.comment_notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy own_mark_read on public.comment_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The badge has to appear without a reload — that is most of the point of a
-- notification. Statement-level like every other topic (0037).
create trigger comment_notifications_notify
  after insert or update or delete on public.comment_notifications
  for each statement execute function public.notify_topic_change('comment_notifications');
