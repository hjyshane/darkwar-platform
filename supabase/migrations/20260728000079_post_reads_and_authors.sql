-- 0079: what you have read, and who wrote it.
--
-- Two small things the boards need. Neither is observation — both are about the
-- people using the dashboard rather than about the game.

-- WHAT YOU HAVE READ.
--
-- Per ACCOUNT, not per browser. localStorage was the cheaper option and it is
-- wrong here: the alliance reads this on a phone and acts on it at a PC, and a
-- read mark that does not follow them makes the whole column noise.
--
-- ONE TABLE FOR BOTH BOARDS, shaped like `favourites` (0022) — nullable target
-- columns with an exactly-one check, rather than a `kind` string and a bare uuid.
-- The difference matters: this way the foreign keys are real, so deleting a guide
-- takes its read marks with it. With a polymorphic `post_id` there is nothing for
-- a foreign key to point at and the table slowly fills with rows about things
-- that no longer exist.
create table public.post_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid references public.guides (guide_id) on delete cascade,
  announcement_id uuid references public.announcements (announcement_id) on delete cascade,
  read_at timestamptz not null default now(),

  constraint post_reads_exactly_one_target check (
    (guide_id is not null)::int + (announcement_id is not null)::int = 1
  )
);

comment on table public.post_reads is
  'One row per account per post read. Shaped like favourites (0022) so the '
  'foreign keys are real and deleting a post takes its read marks with it — a '
  'polymorphic post_id would leave rows about things that no longer exist.';

-- Partial uniques rather than a composite primary key, because the target is
-- one of two nullable columns and a primary key cannot be null.
create unique index post_reads_guide_idx
  on public.post_reads (user_id, guide_id) where guide_id is not null;
create unique index post_reads_announcement_idx
  on public.post_reads (user_id, announcement_id) where announcement_id is not null;

alter table public.post_reads enable row level security;

grant select, insert, delete on public.post_reads to authenticated;
grant all on public.post_reads to service_role;

-- Your own rows and nobody else's, in both directions. "Who has read my notice"
-- is a question this schema deliberately cannot answer: it would turn a reading
-- aid into surveillance, and an officer asking why somebody had not opened a
-- guide is not what the column is for.
create policy own_reads on public.post_reads
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- WHO WROTE IT.
--
-- `created_by` is an auth uuid, and `app_users` lets a member read only their own
-- row (0006) — so a member could not resolve an author at all. A board where
-- every post is by nobody is worse than one with names on it.
--
-- The game name, not the email address. The alliance knows each other by their
-- character; an email is both less useful and more personal.
--
-- NARROWED TO PEOPLE WHO HAVE ACTUALLY WRITTEN SOMETHING. The obvious version
-- exposes the account-to-character link for every member who has one, which is
-- more than the boards need. This exposes it for authors only, and the
-- justification is exactly that: you may see who wrote the thing you are reading.
--
-- DEFINER with the gate in the WHERE clause, and `is_service_request()` alongside
-- it — 0077's lesson. Without that disjunct the collector reads nothing here, and
-- would have to be debugged the day something wants an author name in Discord.
create view public.post_authors as
select
  u.user_id,
  coalesce(p.current_name, 'Unknown member') as display_name
from public.app_users u
left join public.players p on p.player_id = u.player_id
where (
    public.current_app_role() in ('member', 'officer', 'admin')
    or public.is_service_request()
  )
  and (
    exists (select 1 from public.guides g where g.created_by = u.user_id)
    or exists (select 1 from public.announcements a where a.created_by = u.user_id)
  );

comment on view public.post_authors is
  'Author uuid to game name, for people who have written a guide or a notice. '
  'Narrowed to authors on purpose: the boards need to name whoever wrote what '
  'you are reading, not to publish the account-to-character link for everybody.';

grant select on public.post_authors to authenticated;
