-- 0078: the strategy and tips board.
--
-- Longer-lived than a notice. A notice says "gather at 02:00 Saturday" and stops
-- mattering on Sunday; a guide says "this is how the arena line-up works" and
-- matters until the game changes. Same author, same markup, different lifetime —
-- which is why this is its own table and not a `kind` column on `announcements`.
-- An expiry window and a category are the wrong pair of fields to share.
--
-- WHO MAY DO WHAT, and why the two halves are decided differently. 0045 drew
-- this line and it is worth following rather than re-arguing:
--
--   READING is gated by ROLE. "Alliance strategy is not public" is a property of
--   the data, not a switch anybody should be flipping from a settings page.
--   Member and above, like every other alliance-internal table.
--
--   WRITING is gated by a CAPABILITY. Who may write a guide is exactly the kind
--   of thing an alliance changes its mind about — an officer today, a trusted
--   member tomorrow — so it belongs in the permission grid where it can be
--   changed without a migration.
--
-- Seeded so officers can write and edit. That is the point of the board: the
-- people who know how the events work are R4s, and making every tip go through
-- an admin is how a board stays empty.
create table public.guides (
  guide_id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  -- The three kinds the board was asked for, named rather than invented. Not a
  -- free-text field: two people would write 'strategy' and 'Strategy' inside a
  -- week and the list would sort into two piles.
  category text not null default 'tip'
    check (category in ('info', 'strategy', 'tip')),
  -- Above the rest regardless of date. One flag, not a priority number, for
  -- 0034's reason: a number invites 1-vs-2-vs-10 arguments and reads the same
  -- either way on screen.
  pinned boolean not null default false,
  -- Null is a draft. Drafts exist because publishing is what posts to Discord
  -- (the next migration): somebody writing a long guide over two evenings must
  -- not announce it twice, or announce half of it.
  published_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guides is
  'Strategy notes and tips, written in the dashboard''s markup subset. Longer '
  'lived than an announcement, which is why it is a separate table: a notice '
  'has an expiry window and a guide has a category, and neither field means '
  'anything on the other.';

comment on column public.guides.published_at is
  'Null is a draft, visible only to somebody who may write guides. Publishing '
  'is the act that posts to Discord, so it has to be a separate step from '
  'saving — otherwise a guide written over two evenings announces itself twice.';

create index guides_published_idx on public.guides (pinned desc, published_at desc)
  where published_at is not null;

alter table public.guides enable row level security;

-- No grant to anon. 0065 revoked it schema-wide and set the default, but naming
-- it here keeps the intent local to the table rather than inherited from a
-- migration 13 numbers back.
grant select, insert, update, delete on public.guides to authenticated;
grant all on public.guides to service_role;

-- A published guide, for anybody in the alliance.
create policy member_read on public.guides
  for select to authenticated
  using (
    published_at is not null
    and public.current_app_role() in ('member', 'officer', 'admin')
  );

-- A draft, for whoever may write one. Separate policy rather than an `or` in the
-- first: they are two different sentences, and a reviewer checking "can a member
-- read a draft" should not have to parse a boolean to find the answer.
create policy writer_read_drafts on public.guides
  for select to authenticated
  using (public.has_permission('guide.write'));

create policy writer_insert on public.guides
  for insert to authenticated
  with check (public.has_permission('guide.write'));

create policy writer_update on public.guides
  for update to authenticated
  using (public.has_permission('guide.edit'))
  with check (public.has_permission('guide.edit'));

create policy writer_delete on public.guides
  for delete to authenticated
  using (public.has_permission('guide.delete'));

create trigger guides_set_updated_at
  before update on public.guides
  for each row execute function public.set_updated_at();

-- 0033's rule, third time: an author field the author can write is not an author
-- field. Editing somebody's guide does not make it yours.
create function public.guides_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger guides_actor
  before insert or update on public.guides
  for each row execute function public.guides_set_actor();

create trigger guides_notify
  after insert or update or delete on public.guides
  for each statement execute function public.notify_topic_change('guides');

-- The capabilities. Added in the migration that adds the policies reading them,
-- which is what 0045's comment asks for — a capability with no policy behind it
-- is a switch that does nothing, and that is worse than no switch.
insert into public.capabilities (capability, label, description, sort_order) values
  ('guide.write', 'Write a guide',
   'Create strategy notes and tips, and see everybody''s unpublished drafts.', 80),
  ('guide.edit', 'Edit a guide', 'Any guide, not only your own.', 90),
  ('guide.delete', 'Delete a guide', '', 100);

-- Officers get write and edit; deleting stays with admins.
--
-- Not symmetry for its own sake. A wrong guide can be edited by the next officer
-- who reads it, and the mistake is visible while it lasts. A deleted one is gone
-- with no trace that it existed, and this table has no history — so the
-- irreversible verb keeps the narrower role until there is a reason to widen it.
insert into public.role_permissions (role, capability, allowed)
select r.role, c.capability,
       case
         when r.role = 'admin' then true
         when r.role = 'officer' and c.capability in ('guide.write', 'guide.edit') then true
         else false
       end
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role)
cross join (values ('guide.write'), ('guide.edit'), ('guide.delete')) as c(capability);
