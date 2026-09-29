-- A schedule board's key is unique within its alliance, not the install.
--
-- schedule_categories.category was the primary key (0124), so once ACE could
-- make boards (0194) the two alliances shared one namespace: ACE could not
-- have a "war" board if CBFW had one, and — before 0199 — a board could point
-- across. The key is now (alliance_id, category), and an entry refers to its
-- board by both, so an ACE entry can only sit on an ACE board.

-- Everything written before 0192 carried no alliance and was the primary's.
update public.schedule_categories
   set alliance_id = public.primary_own_alliance()
 where alliance_id is null;
update public.schedule_events
   set alliance_id = public.primary_own_alliance()
 where alliance_id is null;

alter table public.schedule_events drop constraint schedule_events_category_fkey;

-- An entry filed under another alliance's board (possible while the key was
-- shared) loses the board and keeps its place on the calendar, the same
-- thing deleting a board does to it.
update public.schedule_events e
   set category = null
 where e.category is not null
   and not exists (
     select 1 from public.schedule_categories c
      where c.category = e.category
        and c.alliance_id is not distinct from e.alliance_id);

alter table public.schedule_categories drop constraint schedule_categories_pkey;
-- NULLS NOT DISTINCT: an install with nothing pinned files boards under no
-- alliance, and they must still be unique there.
alter table public.schedule_categories
  add constraint schedule_categories_alliance_category_key
  unique nulls not distinct (alliance_id, category);

-- Deleting a board clears the entry's board, not its alliance.
alter table public.schedule_events
  add constraint schedule_events_category_fkey
  foreign key (alliance_id, category)
  references public.schedule_categories (alliance_id, category)
  on delete set null (category);

-- The reminders view: a reminder takes its label and channel from its own
-- alliance's board. 0199's body, the join narrowed.
create or replace view public.schedule_reminders_due
with (security_invoker = true) as
select
  r.reminder_id,
  r.schedule_event_id,
  r.minutes_before,
  e.title,
  e.starts_at,
  e.category,
  c.label as category_label,
  c.channel,
  e.starts_at - make_interval(mins => r.minutes_before) as fire_at,
  e.alliance_id
from public.schedule_reminders r
join public.schedule_events e using (schedule_event_id)
left join public.schedule_categories c
  on c.category = e.category
 and c.alliance_id is not distinct from e.alliance_id;
