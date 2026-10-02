-- 0206: scout bodies join battle_report_ingests; the kind check knows them,
-- still refuses anything else, and only admins read the table.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000bc001', 'scout-report-test');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000bc101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sr-admin@test.invalid'),
  ('00000000-0000-4000-8000-0000000bc102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sr-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000bc101', 'admin', 'sr admin'),
  ('00000000-0000-4000-8000-0000000bc102', 'officer', 'sr officer')
on conflict (user_id) do update set role = excluded.role;

-- 1. A scout body is a kind the table accepts.
select lives_ok(
  $$ insert into public.battle_report_ingests
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, report_kind, mail_uid, mail_type, report_content)
     values (gen_random_uuid(), 'chat.get.system.mails', '1.0.0', 'sr-test:scout', now(),
        '00000000-0000-4000-8000-0000000bc001', 580, 'scout', 'm-1', 8, 'CgYIARIC') $$,
  'report_kind scout is accepted');

-- 2. The existing kinds still are.
select lives_ok(
  $$ insert into public.battle_report_ingests
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, report_kind, mail_uid, mail_type, report_content)
     values (gen_random_uuid(), 'push.mail', '1.0.0', 'sr-test:battle', now(),
        '00000000-0000-4000-8000-0000000bc001', 580, 'mail_simple', 'm-2', 72, 'EIPd2wVG') $$,
  'report_kind mail_simple is still accepted');

-- 3. Anything else is refused.
select throws_ok(
  $$ insert into public.battle_report_ingests
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, report_kind)
     values (gen_random_uuid(), 'push.mail', '1.0.0', 'sr-test:bogus', now(),
        '00000000-0000-4000-8000-0000000bc001', 580, 'spy') $$,
  '23514', null, 'an unknown report_kind is refused');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

set local role authenticated;
-- 4. An admin reads the scout report.
select pg_temp.as_user('00000000-0000-4000-8000-0000000bc101');
select is((select count(*) from public.battle_report_ingests
            where idempotency_key like 'sr-test:%')::int, 2,
  'an admin reads scout and battle reports');
-- 5. An officer does not: the bodies name other players' troops.
select pg_temp.as_user('00000000-0000-4000-8000-0000000bc102');
select is((select count(*) from public.battle_report_ingests
            where idempotency_key like 'sr-test:%')::int, 0,
  'an officer does not read report bodies');
reset role;

select * from finish();
rollback;
