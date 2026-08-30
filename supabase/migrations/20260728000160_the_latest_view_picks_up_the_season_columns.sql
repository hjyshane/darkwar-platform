-- 0160: re-expand rank_period_latest so the season columns are readable.
--
-- 0159 added `lab_level` and `lab_adjustment` to `rank_period_snapshots` and
-- stopped there. `rank_period_latest` is written as `select *`, and a view's
-- star is expanded ONCE, at creation, into a frozen column list — so the view
-- still returns the columns as they stood in 0156 and the two new ones are
-- invisible through it. The scorer writes them; nothing can read them.
--
-- This is the second time: 0156 exists for exactly this reason, to re-expand
-- the same view after 0155 added below_minimum. The note it left ("Re-expanded
-- in 0156 to pick up 0155's below_minimum") was the warning, and 0159 walked
-- past it anyway. Hence the sentence in the comment below, which is aimed at
-- whoever adds the next column.
--
-- It fails QUIETLY, which is why it is worth a migration of its own rather
-- than a footnote: the screens read the view, so a request for the new columns
-- comes back as a PostgREST 400 naming a column that plainly exists in the
-- table. Nothing about that error points at the view.
--
-- `create or replace view` accepts this because both columns were APPENDED to
-- the table, so the re-expansion only adds to the end of the list and every
-- existing reader keeps the column order it was written against.
--
-- No scoring change, no version bump: this migration reads nothing and
-- computes nothing. It only makes visible what 0159 already writes.

create or replace view public.rank_period_latest
with (security_invoker = true) as
select distinct on (period_start, player_id) *
from public.rank_period_snapshots
order by period_start, player_id, scoring_version desc, computed_at desc;

comment on view public.rank_period_latest is
  'The newest scoring_version per member per period. The screen reads this so '
  'that keeping an old answer does not mean showing it. THE STAR IS FROZEN AT '
  'CREATION: any migration that adds a column to rank_period_snapshots must '
  're-run this create-or-replace, or the column is written but unreadable '
  'through the view. Re-expanded in 0156 for 0155''s below_minimum, and in '
  '0160 for 0159''s lab_level/lab_adjustment.';
