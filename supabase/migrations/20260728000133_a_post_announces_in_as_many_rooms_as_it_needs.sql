-- 0133: a notice or a guide picks channels, plural.
--
-- 0127 gave each post ONE channel, overriding the per-event default from
-- settings, and the reason it gave was that "the dashboard is down tonight" and
-- "here is the war plan for Saturday" are both notices and belong in different
-- rooms. That is right and it stops one step short: some posts belong in BOTH.
-- A maintenance window belongs in #general and in #officers; a war plan belongs
-- in #war and in whatever room the R4s actually read. Today the writer picks
-- one and pastes the other by hand, which is the version of the feature that
-- gets forgotten at 2am.
--
-- ONE COLUMN, NOT TWO. `channel` is replaced rather than joined by a second
-- column, because a row that carries both a singular and a plural answer is a
-- row where the two can disagree, and every reader then has to know which wins.
-- The array IS the answer; a single channel is an array of one.
--
-- NULL STILL MEANS THE DEFAULT — unchanged from 0127, and still what almost
-- every post wants. Null is "wherever this kind of post normally goes", not
-- "unset waiting to be filled in". An EMPTY array would be a third state
-- meaning "nowhere", which nobody asked for and which reads identically to null
-- in a checkbox list, so the trigger below folds empty back to null rather than
-- letting a form that unticks everything invent a silent post.
alter table public.announcements add column channels text[];
alter table public.guides add column channels text[];

-- The `set_updated_at` triggers are held off for the copy. Moving a name from
-- one column to another is not somebody editing the post, and `updated_at` is
-- shown to readers as when it last changed.
alter table public.announcements disable trigger announcements_set_updated_at;
alter table public.guides disable trigger guides_set_updated_at;

update public.announcements set channels = array[channel] where channel is not null;
update public.guides set channels = array[channel] where channel is not null;

alter table public.announcements enable trigger announcements_set_updated_at;
alter table public.guides enable trigger guides_set_updated_at;

alter table public.announcements drop column channel;
alter table public.guides drop column channel;

comment on column public.announcements.channels is
  'Which Discord channels this notice announces in, or null for the channel '
  'set for notices in settings. NAMES, never URLs (0076). One row per name is '
  'sent, so a post in two rooms is two messages.';

comment on column public.guides.channels is
  'Which Discord channels this guide announces in, or null for the channel set '
  'for guides in settings. NAMES, never URLs (0076). One row per name is sent, '
  'so a post in two rooms is two messages.';

-- ------------------------------------------------------- keeping the names honest
--
-- 0127 had a FOREIGN KEY doing two jobs: rejecting a channel that does not
-- exist, and blanking the column when an admin deleted the webhook. An array
-- cannot carry a foreign key, so both jobs move to triggers — and this is a
-- LOSS worth naming rather than glossing: a trigger is code that can be dropped
-- or disabled, where a constraint is not. It is written here in one place, for
-- both tables, with the pgTAP in 78 asserting each half.
--
-- SECURITY DEFINER because the check reads `notification_channels`, which is
-- admin-only including select (0076). An officer writing a guide would
-- otherwise see an empty table and have every channel name rejected as unknown
-- — the exact failure 0125 was written to prevent, arriving through a different
-- door. The function reads one column and returns a boolean; it hands nothing
-- back that the invoker could not already read from
-- `notification_channel_names`.
create function public.normalize_post_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unknown text;
begin
  -- Sorted, de-duplicated, and stripped of the empty strings a form sends when
  -- somebody ticks and unticks. Sorted so that two saves that chose the same
  -- rooms in a different order are the same row, which keeps a diff on the
  -- settings screen readable and keeps `is distinct from` honest below.
  select array_agg(distinct name order by name)
    into new.channels
    from unnest(coalesce(new.channels, '{}'::text[])) as name
   where name is not null and name <> '';

  -- Empty is not a third state. See the header.
  if new.channels = '{}'::text[] then
    new.channels := null;
  end if;

  if new.channels is not null then
    select name into unknown
      from unnest(new.channels) as name
     where not exists (
       select 1 from public.notification_channels c where c.channel = name
     )
     limit 1;
    if unknown is not null then
      raise exception 'no such notification channel: %', unknown
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.normalize_post_channels() is
  'Sorts and de-duplicates a post''s channel list, folds empty to null, and '
  'rejects a name with no webhook behind it — the check the foreign key on '
  '0127''s singular column used to do.';

create trigger normalize_channels
  before insert or update of channels on public.announcements
  for each row execute function public.normalize_post_channels();

create trigger normalize_channels
  before insert or update of channels on public.guides
  for each row execute function public.normalize_post_channels();

-- The other half of what the foreign key did. `on delete set null` meant
-- deleting a webhook quietly returned its posts to the settings default; the
-- same thing happens here, one name at a time, so a post that named two rooms
-- keeps the room that still exists.
create function public.forget_deleted_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.announcements
     set channels = nullif(array_remove(channels, old.channel), '{}'::text[])
   where channels @> array[old.channel];
  update public.guides
     set channels = nullif(array_remove(channels, old.channel), '{}'::text[])
   where channels @> array[old.channel];
  return old;
end;
$$;

comment on function public.forget_deleted_channel() is
  'Takes a deleted channel out of every post that named it, leaving the other '
  'names alone — what `on delete set null` did on 0127''s singular column.';

create trigger forget_channel
  after delete on public.notification_channels
  for each row execute function public.forget_deleted_channel();

-- ------------------------------------------------- not re-announcing the board
--
-- The notifier's idempotency key for a post was `guide:<id>:<published_at>`,
-- with no channel in it, because there was only ever one. Sending to several
-- means one key per channel or the second room never hears anything — so the
-- key gains a `:<channel>` suffix in the same commit as this file.
--
-- Which makes every key already in the outbox the wrong shape. Left alone, the
-- first pass after deploy would look at the notices and guides inside the
-- backlog window, find no key matching the new shape, and announce all of them
-- again — to the whole alliance, which is the one kind of bug this outbox
-- exists to prevent.
--
-- So the old keys are re-stated in the new shape and marked delivered. A row
-- that was still PENDING keeps its old row too and will be sent from it; the
-- tombstone only stops it being composed a second time under the new name.
insert into public.notification_outbox (channel, event, idempotency_key, title, body, delivered_at)
select
  outbox.channel,
  outbox.event,
  outbox.idempotency_key || ':' || outbox.channel,
  outbox.title,
  outbox.body,
  coalesce(outbox.delivered_at, now())
from public.notification_outbox as outbox
where outbox.event in ('guides', 'notices')
on conflict (idempotency_key) do nothing;
