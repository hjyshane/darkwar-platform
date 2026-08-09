-- player_component_power_history: definer now, and every answer it used to
-- give under invoker+RLS, it must still give.
--
-- 0104 flipped this view to SECURITY DEFINER because the invoker shape ran the
-- uninlinable current_app_role() per row and per board row inside the
-- correlated board_size count — the statement timeout the player page
-- reported. The flip is the risky part: RLS used to decide who sees anything,
-- and the metric-visibility WHERE decided who sees admin metrics. Both rules
-- now live in the view's own gates, so this file asserts the whole access
-- table by reader, with an admin-only metric planted to catch a gate that
-- fails open.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000640001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comp-member@test.invalid'),
  ('00000000-0000-4000-8000-000000640002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comp-admin@test.invalid'),
  ('00000000-0000-4000-8000-000000640003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'comp-viewer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-000000640001', 'member'),
  ('00000000-0000-4000-8000-000000640002', 'admin'),
  ('00000000-0000-4000-8000-000000640003', 'viewer');

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-000000640c01', 'component probe');
insert into public.players (game_uid, server_id, current_name)
values (640000000001, 580, 'CompProbe');

-- One board (one observation): three member-visibility rows for our player
-- plus one admin-only row (migrate_power is visibility='admin' in
-- component_metrics since 0083). board_size counts what the READER may see,
-- so the same board is a different size to a member and an admin — that is
-- the visibility rule expressed as a number, and exactly where a fail-open
-- gate would show first.
insert into public.player_component_power_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   metric, power, rank, board_type, raw)
select '00000000-0000-4000-8000-000000640e01', 'rank.get.by.range', 1,
       'test:63:' || v.metric, '2026-08-08T12:00:00Z',
       '00000000-0000-4000-8000-000000640c01', 580,
       (select player_id from public.players where game_uid = 640000000001),
       580, 640000000001, v.metric, v.power, v.rank, 1, '{}'::jsonb
from (values ('hero_power_total', 900000, 3),
             ('pet_power_total',  400000, 5),
             ('hero_power_best',  300000, 2),
             ('migrate_power',    123456, 1)) as v(metric, power, rank);

create function pg_temp.probe_rows() returns bigint language sql as $$
  select count(*) from public.player_component_power_history
  where player_id = (select player_id from public.players where game_uid = 640000000001);
$$;

-- A member: the three member-visibility metrics, and a board size that
-- excludes the admin row they cannot see.
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000640001","role":"authenticated"}', true);

select is(pg_temp.probe_rows(), 3::bigint,
  'a member sees the member-visibility metrics and not migrate_power');

select is(
  (select distinct board_size from public.player_component_power_history
    where player_id = (select player_id from public.players where game_uid = 640000000001)),
  3::bigint,
  'board_size counts the rows the reader may see, so the admin row is not in it');

select is(
  (select metric_label is not null from public.player_component_power_history
    where player_id = (select player_id from public.players where game_uid = 640000000001)
      and metric = 'hero_power_total'),
  true, 'metric labels ride along from component_metrics');

-- An admin: the planted admin metric appears, and the board grows by one.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000640002","role":"authenticated"}', true);

select is(pg_temp.probe_rows(), 4::bigint,
  'an admin sees migrate_power too');

select is(
  (select distinct board_size from public.player_component_power_history
    where player_id = (select player_id from public.players where game_uid = 640000000001)),
  4::bigint,
  'and the same board is one row bigger to an admin');

-- A viewer: nothing, from the caller gate that replaced RLS.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000640003","role":"authenticated"}', true);

select is(pg_temp.probe_rows(), 0::bigint,
  'a viewer gets zero rows, as RLS answered when the view was invoker');

reset role;

-- The shape: definer on purpose, and gated. 58''s assertion 4 exempts a
-- definer view whose definition asks who is asking; losing the gate while
-- staying definer would fail there AND here.
select is_empty(
  $$ select c.relname from pg_class c
      where c.oid = 'public.player_component_power_history'::regclass
        and c.reloptions::text ~ 'security_invoker=(true|on)' $$,
  'the view reads as its owner — that is the fix, not an accident');

select matches(
  pg_get_viewdef('public.player_component_power_history'::regclass),
  'current_app_role',
  'and it asks who is asking');

select * from finish();
rollback;
