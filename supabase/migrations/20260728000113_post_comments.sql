-- 0113: the alliance can answer back.
--
-- Both boards, one table. A comment on a notice and a comment on a guide are
-- the same object with the same lifetime and the same rules; the only thing
-- that differs is which post it hangs off. Two tables would mean two policies,
-- two triggers and two of every test, kept in step by hand.
--
-- SHAPED LIKE `post_reads` (0079), which is to say: NULLABLE TARGET COLUMNS
-- WITH AN EXACTLY-ONE CHECK, not a `board` string beside a bare uuid. The
-- difference is the one 0079 wrote down and it applies here with more force,
-- because a comment outlives a read mark in every way that matters: with real
-- foreign keys, deleting a guide takes its comments with it. With a
-- polymorphic `post_id` there is nothing for a foreign key to point at, no
-- database-level guarantee the post exists at all, and the table fills up over
-- years with threads about things nobody can open. The board a comment belongs
-- to is still a single question — `guide_id is not null` — and the frontend
-- already carries exactly this discriminator for read marks (`BoardConfig.
-- readColumn`), so nothing downstream needs a new concept.
create table public.post_comments (
  comment_id uuid primary key default gen_random_uuid(),

  guide_id uuid references public.guides (guide_id) on delete cascade,
  announcement_id uuid references public.announcements (announcement_id) on delete cascade,

  -- ONE LEVEL DEEP. Null is a comment on the post; set is a reply to one of
  -- those. The rule that a parent may not itself be a reply is enforced by
  -- trigger below, not here — a CHECK cannot see another row.
  --
  -- `cascade` rather than `set null`: an orphaned reply reads as a comment on
  -- the post, which puts an answer to a question next to a different question.
  -- In practice this rarely fires, because deleting a comment is a soft delete.
  parent_comment_id uuid references public.post_comments (comment_id) on delete cascade,

  -- The commenter's ACCOUNT, resolved to their character's name at read time
  -- through `post_authors` (widened below). Deliberately not a name column: the
  -- alliance renames constantly, and a name copied onto the row is wrong the
  -- first time somebody changes theirs.
  --
  -- `set null` on departure, the way 0094 set the other nine: the comment stays
  -- because the thread it is part of stays, and it loses its byline. A comment
  -- outliving its author is the ordinary case here.
  author_user_id uuid references public.app_users (user_id) on delete set null,

  body text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- SOFT DELETE, so a reply does not lose its parent. Removing the row would
  -- cascade the answers away with the question, and a thread with a hole in the
  -- middle reads as a bug. The board renders a deleted comment in place.
  deleted_at timestamptz,

  constraint post_comments_exactly_one_target check (
    (guide_id is not null)::int + (announcement_id is not null)::int = 1
  ),

  -- An empty comment is not a comment. Checked here rather than in the form,
  -- because the form is one of two writers and the other one is a test.
  constraint post_comments_body_not_blank check (
    deleted_at is not null or btrim(body) <> ''
  )
);

comment on table public.post_comments is
  'Comments on both boards, replies one level deep. Shaped like post_reads '
  '(0079) so the foreign keys are real and deleting a post takes its thread '
  'with it. Deletion is soft (deleted_at) so a reply keeps its parent.';

comment on column public.post_comments.parent_comment_id is
  'Null is a comment on the post, set is a reply to one. A reply to a reply is '
  'refused by post_comments_one_level_deep(): the boards are narrow and read '
  'on phones, and nested threads stop being legible at the second indent.';

comment on column public.post_comments.deleted_at is
  'Set means removed. The row stays so that replies keep their parent and the '
  'thread keeps its shape; the board prints "deleted" where the body was.';

-- The read path, exactly: one post's comments, oldest first. Partial because
-- every row has one of the two set and neither index should carry the other
-- board's rows.
create index post_comments_guide_idx
  on public.post_comments (guide_id, created_at) where guide_id is not null;
create index post_comments_announcement_idx
  on public.post_comments (announcement_id, created_at) where announcement_id is not null;

-- Replies are fetched with their parent's post, not by parent, but a delete
-- cascade walks this direction and does it once per removed comment.
create index post_comments_parent_idx
  on public.post_comments (parent_comment_id) where parent_comment_id is not null;

-- ONE LEVEL, ENFORCED IN THE DATABASE.
--
-- The UI is not the place for this. A depth rule that lives only in a React
-- component is a rule that holds until somebody writes a second writer — a
-- script, a test fixture, a future admin screen — and by then the board has
-- threads in it that cannot be rendered.
--
-- Two rules, one trigger, because they are the same mistake seen twice: a
-- reply must hang off a top-level comment, and it must hang off one on the
-- same post. Neither is expressible as a CHECK, which cannot see another row.
--
-- DEFINER because it reads its own table from a context where that table's RLS
-- would otherwise apply: a member replying to a comment must be checked against
-- the real parent, not against the subset of parents their policies let them
-- see. A parent hidden by RLS would silently pass a rule it fails.
create function public.post_comments_one_level_deep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.post_comments;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select * into parent from public.post_comments
   where comment_id = new.parent_comment_id;

  if not found then
    raise exception 'parent comment does not exist'
      using errcode = 'foreign_key_violation';
  end if;

  if parent.parent_comment_id is not null then
    raise exception 'a reply cannot be replied to'
      using errcode = 'check_violation';
  end if;

  if parent.guide_id is distinct from new.guide_id
     or parent.announcement_id is distinct from new.announcement_id then
    raise exception 'a reply belongs to the same post as its parent'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger post_comments_one_level
  before insert or update on public.post_comments
  for each row execute function public.post_comments_one_level_deep();

-- 0033's rule, and 0078 wrote the same function for guides: an author field the
-- author can write is not an author field.
--
-- This one carries a second job. `body` is pinned on any update by somebody who
-- is not the author, which is what makes the moderator policy below safe to
-- write: RLS can say who may update a row but not which columns they may move,
-- so without this a `guide.delete` holder could quietly rewrite a member's
-- comment instead of removing it.
create function public.post_comments_set_actor()
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

  new.author_user_id := old.author_user_id;
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

create trigger post_comments_actor
  before insert or update on public.post_comments
  for each row execute function public.post_comments_set_actor();

create trigger post_comments_set_updated_at
  before update on public.post_comments
  for each row execute function public.set_updated_at();

alter table public.post_comments enable row level security;

-- No hard delete for anybody signed in. Removing a comment is `deleted_at`,
-- which is an UPDATE, and leaving DELETE ungranted means the soft-delete rule
-- cannot be walked around by a client that would rather not implement it.
-- Cascades from a deleted post still work: they run as the table owner.
grant select, insert, update on public.post_comments to authenticated;
grant all on public.post_comments to service_role;

-- READING FOLLOWS THE POST.
--
-- Not a copy of the boards' visibility rules — a reference to them. The
-- subquery is subject to `guides`/`announcements` own RLS for whoever is
-- asking, so a reader sees the comments on exactly the posts they can open:
-- a member sees published ones (0078, 0108), somebody with `guide.write` sees
-- their board's drafts too, and a viewer sees neither.
--
-- Written this way on purpose. The alternative is to restate
-- `published_at is not null and has_permission(...)` here, and the next change
-- to a board's draft rule then has to be made in two places by somebody who
-- remembers this file exists. CLAUDE.md's grep rule is the warning; this is the
-- version that does not need grepping.
create policy member_read on public.post_comments
  for select to authenticated
  using (
    exists (select 1 from public.guides g where g.guide_id = post_comments.guide_id)
    or exists (
      select 1 from public.announcements a
       where a.announcement_id = post_comments.announcement_id
    )
  );

-- WRITING IS FOR MEMBERS AND ABOVE, gated by role rather than by capability.
--
-- 0045's line, applied: capabilities exist for the decisions an alliance
-- changes its mind about — who may write a guide, who may take one down.
-- "Can somebody in the alliance reply to a notice" is not one of those; it is
-- what a board is for. A viewer is somebody who has not been admitted yet, and
-- they stay read-only.
--
-- The post must be one the writer can read, so a draft cannot collect comments
-- from people who cannot see it.
create policy member_insert on public.post_comments
  for insert to authenticated
  with check (
    public.current_app_role() in ('member', 'officer', 'admin')
    and (
      exists (select 1 from public.guides g where g.guide_id = post_comments.guide_id)
      or exists (
        select 1 from public.announcements a
         where a.announcement_id = post_comments.announcement_id
      )
    )
  );

-- Your own comment: edit it, or remove it.
--
-- `deleted_at is null` in USING, so removing is final from the author's side —
-- undeleting is not a feature anybody asked for, and a comment that can come
-- back is a different promise to the person who replied to it.
create policy author_update on public.post_comments
  for update to authenticated
  using (
    author_user_id = (select auth.uid())
    and deleted_at is null
  )
  with check (author_user_id = (select auth.uid()));

-- Whoever may take a post down may take a comment on it down.
--
-- Keyed to the board the comment is on, not to either capability: somebody
-- trusted to delete guides has no business moderating the notice board. The
-- actor trigger above pins `body`, so this is the power to remove and nothing
-- else.
create policy moderator_update on public.post_comments
  for update to authenticated
  using (
    (guide_id is not null and public.has_permission('guide.delete'))
    or (announcement_id is not null and public.has_permission('announcement.delete'))
  )
  with check (
    (guide_id is not null and public.has_permission('guide.delete'))
    or (announcement_id is not null and public.has_permission('announcement.delete'))
  );

-- An open board updates itself.
--
-- Statement-level, like every other topic (0037): a thread gaining a reply is
-- one event to the reader whether it arrived alone or in a batch.
--
-- NOTHING GOES TO DISCORD. The notify worker's backlog windows exist to stop a
-- first run flooding a channel with a fortnight of posts, and a comment is
-- exactly the traffic those windows were protecting the channel from. There is
-- no outbox writer for this table and that is the decision, not an omission.
create trigger post_comments_notify
  after insert or update or delete on public.post_comments
  for each statement execute function public.notify_topic_change('post_comments');

-- THE NAME IS THE CHARACTER, AND NOW IT COVERS COMMENTERS.
--
-- `post_authors` was narrowed to people who had written a guide or a notice,
-- which was the whole of the board until this migration. A commenter who has
-- never posted was not in the view at all, so every ordinary member's comment
-- would have rendered with no name against it — which is most of them, since
-- posts are written by officers and comments by everybody.
--
-- The justification is unchanged and it is what decides this: you may see who
-- wrote the thing you are reading. A comment is a thing you are reading. What
-- widens is the set of people who have written something, not the reason.
--
-- 'Unknown member' IS GONE. The view now returns null when an account has
-- neither a character nor a display name, and each surface says so in its own
-- words — a dash on the boards, which is what "we genuinely cannot name this
-- person" looks like next to real names. Both existing readers already render
-- nothing when an author is absent (`BoardList`'s Row, `BoardPost`'s masthead),
-- so this makes them consistent rather than changing them; 0080's actual fix,
-- falling back to the display name an admin typed, is untouched and is what
-- keeps the null rare.
create or replace view public.post_authors as
select
  u.user_id,
  -- The character first: the alliance knows each other by who they are in the
  -- game, so a linked account reads the same on a comment as on the roster.
  coalesce(p.current_name, u.display_name) as display_name
from public.app_users u
left join public.players p on p.player_id = u.player_id
where (
    public.current_app_role() in ('member', 'officer', 'admin')
    or public.is_service_request()
  )
  and (
    exists (select 1 from public.guides g where g.created_by = u.user_id)
    or exists (select 1 from public.announcements a where a.created_by = u.user_id)
    or exists (
      select 1 from public.post_comments c where c.author_user_id = u.user_id
    )
  );

comment on view public.post_authors is
  'Author uuid to a name: their character, else the display name an admin gave '
  'the account, else null — the boards print a dash rather than calling '
  'somebody unknown. Narrowed to people who have written a guide, a notice or '
  'a comment on purpose: you may see who wrote what you are reading, and the '
  'account-to-character link is not published any wider than that.';

grant select on public.post_authors to authenticated;
