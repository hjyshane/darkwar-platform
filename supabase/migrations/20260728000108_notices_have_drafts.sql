-- 0108: a notice can be written before it is announced.
--
-- Guides have had drafts since 0078 and notices have not, which meant the two
-- boards disagreed about what saving does: on one it parks the work, on the
-- other it posts to Discord and the whole alliance reads it. The half-written
-- post is the reason drafts exist at all, and nothing about that reason was
-- ever specific to guides.
--
-- `starts_at` IS NOT REUSED, and the temptation was real — a notice with no
-- start is already "not scheduled". But "starts next Saturday" and "not
-- finished yet" are different facts, and a future-dated notice is a working
-- feature rather than a draft. Overloading the column would mean a notice
-- could not be both scheduled and unfinished, which is exactly the state
-- somebody writing Saturday's plan on Thursday evening is in.
--
-- Same column name and same null-is-draft rule as `guides`, because the two
-- boards already share their list, their pager, their read marks and their
-- editor (0107, 0078). A third way of saying "not published yet" would have to
-- be translated at every one of those seams.
alter table public.announcements add column published_at timestamptz;

-- Every notice that already exists was published the moment it was written;
-- there was no other option. Backfilled to the timestamp that ALREADY meant
-- "when the alliance could first see this" rather than to `created_at` alone,
-- because the Discord notifier keys its outbox on that value — a scheduled
-- notice whose backfill disagreed with its old key would announce itself a
-- second time to everybody.
update public.announcements
   set published_at = coalesce(starts_at, created_at)
 where published_at is null;

comment on column public.announcements.published_at is
  'Null is a draft, visible only to somebody who may post a notice. Publishing '
  'is the act that posts to Discord, so it has to be a separate step from '
  'saving — otherwise a notice written in two sittings announces itself twice. '
  'Same rule and same column name as guides.published_at (0078).';

-- No new index. 0034's reasoning holds: this table is a handful of rows and
-- `announcements_current_idx` already orders the board. The partial index
-- guides carries earns itself because that board grows with every tip anybody
-- writes; a notice board is bounded by how often an admin posts.

-- Reading splits the way it does on guides. `member_read` keeps its capability
-- from 0045 and gains the one condition: a draft is not a notice yet.
drop policy member_read on public.announcements;

create policy member_read on public.announcements
  for select to authenticated
  using (
    published_at is not null
    and public.has_permission('announcement.read')
  );

-- The draft's only reader. A separate policy rather than an `or` inside the
-- one above, for 0078's reason: somebody checking "can a member read a draft"
-- should find the answer in a sentence rather than by parsing a boolean.
--
-- Keyed on `announcement.write` rather than `announcement.edit`. Seeing
-- everybody's unfinished notices is the writers' room, and it should open for
-- the people who write them rather than for anyone trusted to fix a typo in
-- one that is already up. 0078 drew the same line for guides.
create policy writer_read_drafts on public.announcements
  for select to authenticated
  using (public.has_permission('announcement.write'));
