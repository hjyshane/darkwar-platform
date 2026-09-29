-- 0203: a schedule board's key is unique within its alliance; an entry sits
-- only on its own alliance's board.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

update public.alliances set is_own = false, roster_unredacted_seen = false
 where is_own or roster_unredacted_seen;
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000bb001', 580, 'ext-sb-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000bb002', 581, 'ext-sb-b', 'Bravo', 'BBB');
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000bb001",
                                           "00000000-0000-4000-8000-0000000bb002"]}');

-- 1. Both alliances may have a board called "sb-war".
select lives_ok(
  $$ insert into public.schedule_categories (category, label, alliance_id) values
       ('sb-war', 'Alpha war', '00000000-0000-4000-8000-0000000bb001'),
       ('sb-war', 'Bravo war', '00000000-0000-4000-8000-0000000bb002') $$,
  'two alliances can each have a board with the same key');

-- 2. But not two in one alliance.
select throws_ok(
  $$ insert into public.schedule_categories (category, label, alliance_id)
     values ('sb-war', 'again', '00000000-0000-4000-8000-0000000bb001') $$,
  '23505', null, 'the key is still unique within an alliance');

-- 3. An entry cannot sit on another alliance's board.
insert into public.schedule_categories (category, label, alliance_id)
values ('sb-alpha-only', 'Alpha only', '00000000-0000-4000-8000-0000000bb001');
select throws_ok(
  $$ insert into public.schedule_events (title, starts_at, category, alliance_id)
     values ('sb smuggled', now(), 'sb-alpha-only', '00000000-0000-4000-8000-0000000bb002') $$,
  '23503', null, 'a Bravo entry cannot use an Alpha board');

-- 4. A reminder reads its own alliance's board, not the other with the same key.
insert into public.schedule_events (schedule_event_id, title, starts_at, category, alliance_id)
values ('00000000-0000-4000-8000-0000000bb301', 'sb bravo rally', now() + interval '1 hour',
        'sb-war', '00000000-0000-4000-8000-0000000bb002');
insert into public.schedule_reminders (schedule_event_id, minutes_before)
values ('00000000-0000-4000-8000-0000000bb301', 30);
select is(
  (select category_label from public.schedule_reminders_due
    where schedule_event_id = '00000000-0000-4000-8000-0000000bb301'),
  'Bravo war', 'a reminder takes its label from its own alliance''s board');

-- 5. Deleting a board clears the entry's board and keeps its alliance.
delete from public.schedule_categories
 where category = 'sb-war' and alliance_id = '00000000-0000-4000-8000-0000000bb002';
select is(
  (select row(category, alliance_id)::text from public.schedule_events
    where schedule_event_id = '00000000-0000-4000-8000-0000000bb301'),
  row(null::text, '00000000-0000-4000-8000-0000000bb002'::uuid)::text,
  'deleting a board unsets the entry''s board, not its alliance');

select * from finish();
rollback;
