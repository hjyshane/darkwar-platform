-- 0205: an account's captured inventory and levels are readable by the member
-- who claimed that character, and by nobody else — not another member, not an
-- admin, not anon. The service key writes them.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ac001', 'account-state-test');

insert into public.players (player_id, server_id, game_uid, current_name)
values
  ('00000000-0000-4000-8000-0000000ac201', 580, 9260000000000580, 'owner char'),
  ('00000000-0000-4000-8000-0000000ac202', 580, 9260000000001580, 'other char');

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-0000000ac101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'as-owner@test.invalid'),
  ('00000000-0000-4000-8000-0000000ac102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'as-other@test.invalid'),
  ('00000000-0000-4000-8000-0000000ac103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'as-admin@test.invalid');
insert into public.app_users (user_id, role, display_name, player_id) values
  ('00000000-0000-4000-8000-0000000ac101', 'member', 'owner', '00000000-0000-4000-8000-0000000ac201'),
  ('00000000-0000-4000-8000-0000000ac102', 'member', 'other', '00000000-0000-4000-8000-0000000ac202'),
  ('00000000-0000-4000-8000-0000000ac103', 'admin', 'admin', null)
on conflict (user_id) do update set role = excluded.role, player_id = excluded.player_id;
insert into public.user_players (player_id, user_id) values
  ('00000000-0000-4000-8000-0000000ac201', '00000000-0000-4000-8000-0000000ac101'),
  ('00000000-0000-4000-8000-0000000ac202', '00000000-0000-4000-8000-0000000ac102')
on conflict do nothing;

-- Two logins by the owner's character, one by the other member's.
insert into public.account_state_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid, items, buildings)
values
  (gen_random_uuid(), 'init', '1.0.0', 'as-test:1', '2026-10-01 03:00+00',
   '00000000-0000-4000-8000-0000000ac001', 580, 580,
   '00000000-0000-4000-8000-0000000ac201', 9260000000000580, '{"200202": 10}', '{"1001": 30}'),
  (gen_random_uuid(), 'init', '1.0.0', 'as-test:2', '2026-10-02 03:00+00',
   '00000000-0000-4000-8000-0000000ac001', 580, 580,
   '00000000-0000-4000-8000-0000000ac201', 9260000000000580, '{"200202": 12}', '{"1001": 31}'),
  (gen_random_uuid(), 'init', '1.0.0', 'as-test:3', '2026-10-02 04:00+00',
   '00000000-0000-4000-8000-0000000ac001', 580, 580,
   '00000000-0000-4000-8000-0000000ac202', 9260000000001580, '{"200202": 99}', '{}');

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

set local role authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-0000000ac101');
-- 1. The owner sees both of their own logins.
select is((select count(*) from public.account_state_snapshots)::int, 2,
  'the owner reads their own character''s logins');
-- 2. And none of anyone else's.
select is((select count(*) from public.account_state_snapshots
            where player_id = '00000000-0000-4000-8000-0000000ac202')::int, 0,
  'the owner does not read another member''s inventory');
-- 3. The latest view gives the newest login.
select is((select items ->> '200202' from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000ac201'), '12',
  'account_state_latest is the newest login');

select pg_temp.as_user('00000000-0000-4000-8000-0000000ac102');
-- 4. The other member sees only their own, through the view as well.
select is((select count(*) from public.account_state_latest)::int, 1,
  'another member sees only their own character in the view');
select is((select count(*) from public.account_state_latest
            where player_id = '00000000-0000-4000-8000-0000000ac201')::int, 0,
  'and cannot read the owner''s latest state');

select pg_temp.as_user('00000000-0000-4000-8000-0000000ac103');
-- 6. An admin with no claim on either character sees nothing.
select is((select count(*) from public.account_state_snapshots)::int, 0,
  'an admin does not read members'' inventories');

-- 7. A member cannot write their own state; only the collector does.
select throws_ok(
  $$ insert into public.account_state_snapshots
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, server_id, game_uid)
     values (gen_random_uuid(), 'init', '1.0.0', 'as-test:forged', now(),
        '00000000-0000-4000-8000-0000000ac001', 580, 580, 9260000000000580) $$,
  '42501', null, 'authenticated cannot insert account state');
reset role;

-- 8. anon has no read on either relation.
select ok(not has_table_privilege('anon', 'public.account_state_snapshots', 'select')
          and not has_table_privilege('anon', 'public.account_state_latest', 'select'),
  'anon cannot read account state');

-- 9. The view runs as the caller, so the owner-only policy decides.
select ok((select coalesce('security_invoker=true' = any(reloptions), false)
             from pg_class where oid = 'public.account_state_latest'::regclass),
  'account_state_latest is security_invoker');

-- 10. The collector's key can write and read it.
set local role service_role;
select lives_ok(
  $$ insert into public.account_state_snapshots
       (observation_id, source_command, parser_version, idempotency_key, captured_at,
        collector_id, collected_from_server_id, server_id, game_uid)
     values (gen_random_uuid(), 'init', '1.0.0', 'as-test:service', now(),
        '00000000-0000-4000-8000-0000000ac001', 580, 580, 9260000000000580) $$,
  'service_role writes account state');
select is((select count(*) from public.account_state_latest)::int, 2,
  'service_role reads the latest state of every character');
reset role;

select * from finish();
rollback;
