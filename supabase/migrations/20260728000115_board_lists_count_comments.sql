-- 0115: how many people answered, without opening the post.
--
-- The board list already says whether a post is new to you (0079's read
-- marks). "Is anybody talking about it" is the other question a reader scans
-- for, and until now the only way to answer it was to open every post.
--
-- A VIEW, NOT A COLUMN ON THE POST. A cached `comment_count` on `guides` and
-- `announcements` would need a trigger on every insert, update and soft
-- delete, and would be wrong for exactly as long as anybody got that wrong.
-- These boards are small enough that counting is free, and a count that
-- cannot drift is worth more here than one that is slightly cheaper to read.
--
-- `security_invoker`, so the count a reader sees is the count of comments that
-- reader may read. A member counting the comments on a draft they cannot open
-- would be told the draft exists.
create view public.post_comment_counts with (security_invoker = true) as
select
  c.guide_id,
  c.announcement_id,
  count(*) as comment_count
from public.post_comments c
-- Deleted comments are not comments. A tombstone still renders inside the
-- thread so a reply keeps its parent (0113), but "4 comments" that opens onto
-- two and two "Deleted." is a lie the list should not tell.
where c.deleted_at is null
group by c.guide_id, c.announcement_id;

comment on view public.post_comment_counts is
  'Live comment count per post, for the board lists. Counted rather than '
  'cached on the post: a stored column would need a trigger on insert, update '
  'and soft delete, and these boards are small enough that the count is free. '
  'security_invoker, so a reader counts only what they may read.';

grant select on public.post_comment_counts to authenticated;
