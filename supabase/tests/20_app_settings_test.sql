-- 0032: an admin can state which alliance is ours, and only an admin can.
--
-- §20.2 requires a negative test per policy, and this table has two: everyone
-- reads it (the overview renders from it while logged out), only an admin
-- writes it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000a2001', 580, 'ext-obs', 'Observed', 'OBS'),
  ('00000000-0000-4000-8000-0000000a2002', 580, 'ext-pin', 'Pinned', 'PIN');

-- Stand in for what apply_roster_summary would have written from an
-- unredacted roster, without needing a whole snapshot to say one thing.
update public.alliances set roster_unredacted_seen = true
where alliance_id = '00000000-0000-4000-8000-0000000a2001';

-- "No pin" has to be arranged, not assumed. own_alliance is a single-row
-- setting an admin writes from the dashboard, so any database somebody has
-- actually used may already hold one — and then the insert below collides on
-- the primary key and every assertion after it is skipped. Safe because the
-- whole file runs inside a transaction that rolls back, so the admin's real
-- pin is untouched. Same lesson as 21_announcements: a test must not assume
-- it is the only thing that ever wrote to the table.
delete from public.app_settings where key = 'own_alliance';
select public.resolve_own_alliance();

select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2001'), true,
  'with no pin, is_own follows the evidence');
select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2002'), false,
  'and an alliance with no evidence is not ours');

-- The pin wins over the evidence. That is the whole reason it exists: the
-- case for having it is the case where the observation is wrong.
insert into public.app_settings (key, value)
values ('own_alliance',
        '{"alliance_id": "00000000-0000-4000-8000-0000000a2002"}'::jsonb);

select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2002'), true,
  'a pinned alliance is ours even with no roster evidence');
select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2001'), false,
  'and the pin unmarks the one the evidence pointed at');

-- The evidence is not destroyed by disagreeing with it. "The admin says PIN
-- but every roster we hold is OBS's" has to stay noticeable.
select is((select roster_unredacted_seen from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2001'), true,
  'the observation survives being overruled');

-- Removing the pin falls back rather than leaving nothing marked.
delete from public.app_settings where key = 'own_alliance';
select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2001'), true,
  'clearing the pin returns to the evidence');

-- RLS. A row has to exist first: the pin was just deleted, and asserting
-- "anon sees something" against an empty table proves nothing about the
-- policy — it fails for the wrong reason, which is how this test was wrong
-- the first time.
insert into public.app_settings (key, value)
values ('overview_note', '{"text": "readable by everyone"}'::jsonb);

set local role anon;
select isnt_empty($$ select * from public.app_settings $$,
  'anon can read settings — the overview renders from them logged out');

select throws_ok(
  $$ insert into public.app_settings (key, value) values ('x', '{}'::jsonb) $$,
  '42501', null, 'anon cannot write settings');
reset role;

-- The POSITIVE case, which is what was missing. 0032 granted only SELECT, so
-- the admin_write policy governed a privilege nobody held and every write —
-- an admin's included — was refused before RLS was reached. A suite that only
-- asks "can the wrong person write?" passes happily against a table no one
-- can write.
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000ad001')::text, true);
$$;

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000ad001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'settings-admin@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-0000000ad001', 'admin', 'settings admin');

set local role authenticated;
select pg_temp.as_admin();
select lives_ok(
  $$ insert into public.app_settings (key, value)
     values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-0000000a2002"}'::jsonb) $$,
  'an admin can write settings');
select is((select is_own from public.alliances
           where alliance_id = '00000000-0000-4000-8000-0000000a2002'), true,
  'and the pin takes effect through the trigger');
select is((select updated_by from public.app_settings where key = 'own_alliance'),
          '00000000-0000-4000-8000-0000000ad001'::uuid,
  'updated_by comes from the session, not the request body');
reset role;

select has_column('public', 'alliances', 'roster_unredacted_seen',
  'the observation keeps its own column, separate from the belief');

select * from finish();
rollback;
