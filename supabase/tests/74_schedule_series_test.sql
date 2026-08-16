-- 0126: a repeat is occurrences, and they stay ordinary entries.
--
-- The point of materialising rather than storing a rule is that nothing else
-- has to learn about series. So the assertions are mostly about what did NOT
-- change: one occurrence deletes alone, an edit to one does not touch its
-- siblings, and the reminder view answers for each of them the same way it
-- answers for a one-off.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.schedule_categories (category, label) values ('bear', 'Bear hunt');

-- Four Mondays, as the editor would write them: same title, same clock, one
-- shared series id, a reminder each.
insert into public.schedule_events
  (schedule_event_id, title, category, starts_at, series_id)
values
  ('00000000-0000-4000-8000-0000000fa001', 'Bear hunt', 'bear',
   '2026-08-17T22:00:00Z', '00000000-0000-4000-8000-0000000fb001'),
  ('00000000-0000-4000-8000-0000000fa002', 'Bear hunt', 'bear',
   '2026-08-24T22:00:00Z', '00000000-0000-4000-8000-0000000fb001'),
  ('00000000-0000-4000-8000-0000000fa003', 'Bear hunt', 'bear',
   '2026-08-31T22:00:00Z', '00000000-0000-4000-8000-0000000fb001'),
  ('00000000-0000-4000-8000-0000000fa004', 'Bear hunt', 'bear',
   '2026-09-07T22:00:00Z', '00000000-0000-4000-8000-0000000fb001');

insert into public.schedule_reminders (schedule_event_id, minutes_before)
select schedule_event_id, 30 from public.schedule_events
where series_id = '00000000-0000-4000-8000-0000000fb001';

select is(
  (select count(*) from public.schedule_reminders_due
    where schedule_event_id in (
      select schedule_event_id from public.schedule_events
      where series_id = '00000000-0000-4000-8000-0000000fb001')),
  4::bigint,
  'every occurrence reminds on its own - the notifier learned nothing about '
  'series and does not have to');

select is(
  (select fire_at from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000fa002'),
  '2026-08-24T21:30:00Z'::timestamptz,
  'and each one reminds before ITSELF, not before the first of them');

-- Moving one week is an ordinary edit. Under a rule this is the case that
-- needs an exception table; here it needs nothing.
update public.schedule_events
set starts_at = '2026-08-25T22:00:00Z'
where schedule_event_id = '00000000-0000-4000-8000-0000000fa002';

select is(
  (select starts_at from public.schedule_events
    where schedule_event_id = '00000000-0000-4000-8000-0000000fa003'),
  '2026-08-31T22:00:00Z'::timestamptz,
  'moving one occurrence leaves its siblings where they were');

-- Skipping one is an ordinary delete.
delete from public.schedule_events
where schedule_event_id = '00000000-0000-4000-8000-0000000fa001';

select is(
  (select count(*) from public.schedule_events
    where series_id = '00000000-0000-4000-8000-0000000fb001'),
  3::bigint,
  'deleting one occurrence deletes one occurrence');

-- And the whole series goes together when that is what was meant.
delete from public.schedule_events
where series_id = '00000000-0000-4000-8000-0000000fb001';

select is(
  (select count(*) from public.schedule_reminders_due
    where title = 'Bear hunt'),
  0::bigint,
  'deleting the series takes its reminders with it, through the cascade that '
  'was already there');

select * from finish();
rollback;
