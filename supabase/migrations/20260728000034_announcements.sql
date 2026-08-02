-- 0034: notices and events an admin writes by hand.
--
-- A table rather than another app_settings key. A setting is one current
-- value; these are a list with their own lifetimes — several live at once,
-- each appears and expires on its own schedule, and each wants to say who
-- wrote it. Cramming that into one jsonb blob would mean rewriting the whole
-- blob to edit one notice, and losing per-row RLS with it.
--
-- This is NOT the event framework of §13. That one ingests the game's own
-- event rankings and is still blocked on unconfirmed protocol (§5.3). This
-- is a human typing "duel starts Saturday 02:00 UTC" into a box. Keeping
-- them apart matters: when §13 lands it brings observed facts with
-- provenance, and those must not be mixed into a table whose contents are
-- somebody's typing.

create table public.announcements (
  announcement_id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  -- Optional window. Null start means "already current"; null end means
  -- "until removed". An announcement with neither is a standing notice,
  -- which is the common case and should not require picking dates.
  starts_at timestamptz,
  ends_at timestamptz,
  -- Sorts above the rest regardless of dates. One flag, not a priority
  -- number: a number invites 1 vs 2 vs 10 arguments and reads the same
  -- either way on screen.
  pinned boolean not null default false,
  -- Who may see it. Alliance business and "the dashboard is down tonight"
  -- are both announcements and only one of them is internal, so the author
  -- says which rather than the table deciding for them.
  visibility text not null default 'member'
    check (visibility in ('public', 'member')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An end before a start is not a window, and the UI cannot be the place
  -- that guarantees it — the admin screen is one client of many.
  constraint announcements_window_ordered
    check (starts_at is null or ends_at is null or starts_at < ends_at)
);

comment on table public.announcements is
  'Notices and events written by an admin, not collected from the game. §13 '
  'event data is a separate thing with provenance and does not belong here.';

comment on column public.announcements.visibility is
  'public = anyone with the dashboard address; member = alliance roles only. '
  'Enforced by RLS, not by whether the UI draws it.';

-- No `where ends_at > now()` on this: now() is not IMMUTABLE and Postgres
-- rejects it in an index predicate. Which is the right refusal — the index
-- would be correct only at the moment it was built. The expiry filter lives
-- in the query, and this table holds a handful of rows anyway.
create index announcements_current_idx
  on public.announcements (pinned desc, starts_at desc nulls last);

alter table public.announcements enable row level security;
grant select on public.announcements to anon, authenticated;
grant insert, update, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;

-- Read is split by the row's own visibility. Two policies rather than one
-- with an OR so each reads as the sentence it is.
create policy public_read on public.announcements
  for select to anon, authenticated
  using (visibility = 'public');

create policy member_read on public.announcements
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- Writing is admin-only, and the grant above is what makes the policy able
-- to say so — 0033 is the migration that learned that lesson the hard way.
create policy admin_write on public.announcements
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

-- Same reasoning as app_settings (0033): an author field the author can
-- write is not an author field.
create function public.announcements_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    -- Editing a notice does not make you its author.
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger announcements_actor
  before insert or update on public.announcements
  for each row execute function public.announcements_set_actor();

-- Its own notifier rather than notify_data_change(). That one reads a
-- `new_rows` transition table and a server_id off it; an announcement has no
-- server, and a DELETE has no new rows at all — the case that matters most
-- here, since removing a notice everyone can see should reach them as fast
-- as adding one.
create function public.notify_announcement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.data_change_notifications (topic, server_id, payload)
  values ('announcements', null, jsonb_build_object('op', tg_op));
  return null;
end;
$$;

create trigger announcements_notify
  after insert or update or delete on public.announcements
  for each statement execute function public.notify_announcement_change();
