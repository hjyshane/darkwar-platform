-- 0034: who can read which announcement, and who can write one.
--
-- Three policies, so three negatives and — the lesson from 0033 — the
-- matching positives. A table nobody can write passes a write test that only
-- asks whether the wrong person is refused.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ac001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ann-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000ac002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ann-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ac003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ann-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000ac001', 'admin', 'ann admin'),
  ('00000000-0000-4000-8000-0000000ac002', 'member', 'ann member'),
  ('00000000-0000-4000-8000-0000000ac003', 'viewer', 'ann viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- `published_at` is spelled out on every row since 0108. It has no default, so
-- a fixture that omits it is a draft — which is the right default for the
-- column and a trap for a test that means to check ordinary reading.
insert into public.announcements (announcement_id, title, body, visibility, published_at)
values
  ('00000000-0000-4000-8000-0000000a3001', 'Downtime', 'The site is down tonight.',
   'public', now()),
  ('00000000-0000-4000-8000-0000000a3002', 'Duel plan', 'Hit the hive at 02:00.',
   'member', now()),
  -- Written and not announced. The row the draft assertions below are about.
  ('00000000-0000-4000-8000-0000000a3004', 'Half typed', 'TODO finish this',
   'member', null);

-- Reading. Counted over THIS test's two rows, never over the whole table:
-- the database it runs against has whatever anyone put there, and an
-- absolute count turns an unrelated notice into a failure here. The repo
-- has been here before — "assert RLS visibility instead of absolute row
-- counts" was its own commit.
create function pg_temp.mine() returns setof public.announcements language sql as $$
  select * from public.announcements
  where announcement_id in ('00000000-0000-4000-8000-0000000a3001',
                            '00000000-0000-4000-8000-0000000a3002');
$$;

create function pg_temp.draft() returns setof public.announcements language sql as $$
  select * from public.announcements
  where announcement_id = '00000000-0000-4000-8000-0000000a3004';
$$;

-- Until 0065 a 'public' notice was readable logged out and this asserted
-- exactly that. There is no logged-out reader now, so visibility='public'
-- no longer widens anything — it records what the author meant. The column
-- stays for that reason; this assertion moves to saying anon gets nothing.
set local role anon;
select throws_ok($$ select count(*) from public.announcements $$,
  '42501', null, 'anon reads no notice, public or otherwise');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ac003');
-- Was "still one" — the public notice. 0065 dropped announcements'
-- public_read entirely, so the only SELECT policy left is member_read,
-- keyed on the announcement.read capability that a viewer does not hold.
select is((select count(*) from pg_temp.mine()), 0::bigint,
  'a signed-in viewer holds no announcement.read, so sees neither');
select pg_temp.act_as('00000000-0000-4000-8000-0000000ac002');
select is((select count(*) from pg_temp.mine()), 2::bigint,
  'a member sees both');
-- 0108. The negative that matters: announcement.read is the capability a
-- member holds, and it is deliberately not enough for an unfinished notice.
-- Without this, adding the column would have looked like it worked while
-- every draft sat on the board being read.
select is((select count(*) from pg_temp.draft()), 0::bigint,
  'a member holding announcement.read still cannot read a draft');

-- Writing.
select throws_ok(
  $$ insert into public.announcements (title) values ('nope') $$,
  '42501', null, 'a member cannot write an announcement');
-- A refused DELETE does not raise. RLS filters the rows a statement can
-- see, so a member's delete matches nothing and reports success having
-- removed nothing — which is why the assertion is that the row survives
-- rather than that an error was thrown. An INSERT is different: there is no
-- existing row to filter, so the WITH CHECK fails loudly, which is why the
-- test above can look for 42501 and this one cannot.
delete from public.announcements
where announcement_id = '00000000-0000-4000-8000-0000000a3001';
select is((select count(*) from public.announcements
           where announcement_id = '00000000-0000-4000-8000-0000000a3001'), 1::bigint,
  'a member''s delete silently removes nothing rather than erroring');
reset role;

set local role anon;
select throws_ok(
  $$ insert into public.announcements (title) values ('nope') $$,
  '42501', null, 'anon cannot write one either');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000ac001');
-- The matching positive, which is 0033's lesson: a draft nobody can read
-- passes the negative above without the feature working at all.
select is((select count(*) from pg_temp.draft()), 1::bigint,
  'somebody who may post a notice reads the drafts');
select lives_ok(
  $$ insert into public.announcements (announcement_id, title, visibility)
     values ('00000000-0000-4000-8000-0000000a3003', 'Written by admin', 'member') $$,
  'an admin can write one');

-- created_by comes from the session. An author field the author can set is
-- not an author field (0033 said the same about updated_by).
select is((select created_by from public.announcements
           where announcement_id = '00000000-0000-4000-8000-0000000a3003'),
          '00000000-0000-4000-8000-0000000ac001'::uuid,
  'created_by is stamped from the session');

update public.announcements set title = 'Edited'
where announcement_id = '00000000-0000-4000-8000-0000000a3001';
select is((select created_by from public.announcements
           where announcement_id = '00000000-0000-4000-8000-0000000a3001'), null,
  'editing someone else''s notice does not make you its author');
reset role;

-- A window that ends before it starts is not a window, and the UI is one
-- client of several so it cannot be where that is guaranteed.
select throws_ok(
  $$ insert into public.announcements (title, starts_at, ends_at)
     values ('backwards', '2026-08-02T00:00:00Z', '2026-08-01T00:00:00Z') $$,
  '23514', null, 'an end before its start is refused');

-- Changing an announcement has to reach readers, including a deletion —
-- which is why this table does not use notify_data_change(): that one reads
-- a new_rows transition table, and a DELETE has none.
select is((select count(*) from public.data_change_notifications
           where topic = 'announcements') > 0, true,
  'a write notifies subscribers');

select has_column('public', 'announcements', 'visibility',
  'the author says who may see it, rather than the table deciding');

-- Named rather than inferred from the policies above, so that dropping the
-- column fails here with a sentence instead of somewhere downstream with a
-- PostgREST 400.
select has_column('public', 'announcements', 'published_at',
  'a notice can be written before it is announced');

select * from finish();
rollback;
