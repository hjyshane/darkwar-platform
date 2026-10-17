-- 0291: a Capital Clash's window read from the game.
--
-- 11-07 has both facts (start 14:00:00, finish 15:20:04). 11-21 has only a
-- start (the next term, announced weeks ahead). 12-05 has a start and a finish
-- the game reported, but an officer has typed a different window for it, which
-- wins. A finish more than 12 hours after the start is another battle's.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.fact(key text, k text, at timestamptz, seen timestamptz)
returns void language sql as $$
  insert into public.capital_clash_times
    (snapshot_id, observation_id, source_command, parser_version, idempotency_key,
     captured_at, collector_id, collected_from_server_id, kind, at, held_on)
  values (gen_random_uuid(), '00000000-0000-4000-8000-00000000a0b1', 'get.king.info',
          'test', 'test:291:' || key, seen,
          '00000000-0000-4000-8000-000000000c01', 580, k, at,
          ((at at time zone 'UTC') - interval '2 hours')::date);
$$;

select pg_temp.fact('a-start', 'start', '2026-11-07 14:00Z', '2026-10-25 10:00Z');
select pg_temp.fact('a-finish', 'finish', '2026-11-07 15:20:04Z', '2026-11-07 15:21Z');
select pg_temp.fact('b-start', 'start', '2026-11-21 14:00Z', '2026-11-07 16:00Z');
-- A moved start: the latest seen wins.
select pg_temp.fact('c-start1', 'start', '2026-12-05 14:00Z', '2026-11-20 10:00Z');
select pg_temp.fact('c-start2', 'start', '2026-12-05 14:30Z', '2026-12-01 10:00Z');
select pg_temp.fact('c-finish', 'finish', '2026-12-05 15:40Z', '2026-12-05 15:41Z');
-- A finish too far after any start belongs to nothing.
select pg_temp.fact('d-start', 'start', '2026-12-19 14:00Z', '2026-12-10 10:00Z');
select pg_temp.fact('d-finish', 'finish', '2026-12-20 09:00Z', '2026-12-20 09:01Z');

insert into public.capital_clash_window_overrides (held_on, starts_at, ends_at, note)
values ('2026-12-05', '2026-12-05 14:10Z', '2026-12-05 15:30Z', 'typed');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ct-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000a302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ct-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000a301', 'member', 'ct member'),
  ('00000000-0000-4000-8000-00000000a302', 'viewer', 'ct viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.win(day date) returns text language sql as $$
  select to_char(w.starts_at at time zone 'UTC', 'HH24:MI:SS') || ' - '
         || to_char(w.ends_at at time zone 'UTC', 'HH24:MI:SS') || ' ' || coalesce(w.note, '')
    from public.capital_clash_windows w where w.held_on = day;
$$;

select pg_temp.act_as('00000000-0000-4000-8000-00000000a301');
set local role authenticated;

select is(pg_temp.win('2026-11-07'), '14:00:00 - 15:20:04 read from the game',
  'a start and the finish after it make a window');
select is(pg_temp.win('2026-11-21'), null, 'a start with no finish yet has no window');
select is(pg_temp.win('2026-12-05'), '14:10:00 - 15:30:00 typed', 'a typed window beats the game''s');
select is(pg_temp.win('2026-12-19'), null, 'a finish 19 hours later is not this battle''s');
select is((select count(*)::int from public.capital_clash_windows
            where held_on in ('2026-11-07', '2026-11-21', '2026-12-05', '2026-12-19')), 2,
  'one row per day that has a window, never two');

-- The migration's own 10-17 row is still there, typed.
select ok(exists (select 1 from public.capital_clash_windows where held_on = '2026-10-17'),
  '10-17 keeps its seeded window');

select throws_ok($$ delete from public.capital_clash_times $$, '42501', null,
  'a member cannot touch the facts');
select throws_ok($$ delete from public.capital_clash_window_overrides $$, '42501', null,
  'nor the overrides');

select pg_temp.act_as('00000000-0000-4000-8000-00000000a302');
select is((select count(*)::int from public.capital_clash_windows), 0, 'a viewer reads no window');
reset role;

select ok(not has_table_privilege('anon', 'public.capital_clash_windows', 'select')
          and not has_table_privilege('anon', 'public.capital_clash_times', 'select'),
  'anon has no read on the view or the facts');

select * from finish();
rollback;
