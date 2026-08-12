-- 0086: a metric an admin may see and a member may not, and a registry that makes
-- the next metric a row rather than a migration.
--
-- The assertion that matters is the third block. Migration power is the figure
-- behind a decision about whether somebody can move servers, and "admin-only" has
-- to mean the member's QUERY does not carry it — not that React declines to draw
-- it. §20.2 applies: a negative test, and a positive one beside it, because a view
-- that refuses everybody is indistinguishable from a working one until somebody
-- looks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ------------------------------------------------------------------ the registry
select is(
  (select visibility from public.component_metrics where metric = 'migrate_power'),
  'admin',
  'migration power is admin-only');

select is(
  (select count(*) from public.component_metrics where visibility = 'member'),
  8::bigint,
  'and the four board metrics plus 0109''s four account components are not');

-- 0109: the other four components of the profile's six-way power decomposition.
-- Four rows, not six — heroPower/petPower write the existing board metrics.
select is(
  (select count(*) from public.component_metrics
    where family = 'account' and role = 'total' and visibility = 'member'),
  4::bigint,
  'the four account components are member-visible totals');

-- The FK is what replaced 0018's CHECK. Same guarantee, but now the valid set is
-- data — which is the whole point: a new metric is an insert, not a migration that
-- edits a constraint.
select has_column('public', 'component_metrics', 'metric', 'the registry is keyed on the metric name');
select col_is_fk(
  'public', 'player_component_power_snapshots', ARRAY['metric'],
  'the snapshot table points at the registry rather than listing names in a CHECK');

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc86', 'metric test', 'offline', 'test')
on conflict do nothing;

insert into public.players (player_id, server_id, game_uid, current_name)
values ('00000000-0000-4000-8000-0000000ab086', 580, 9900000000000086, 'Mover');

create function pg_temp.reading(metric text, pw bigint, board int) returns void
language sql as $$
  insert into public.player_component_power_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, server_id, player_id, game_uid,
    metric, power, rank, board_type)
  values (gen_random_uuid(),
    case when board is null then 'get.user.info.multi' else 'rank.get.by.range' end,
    'test', 'metric:' || metric, '2026-08-06T12:00:00Z',
    '00000000-0000-4000-8000-00000000cc86', 580, 580,
    '00000000-0000-4000-8000-0000000ab086', 9900000000000086,
    metric, pw, case when board is null then null else 7 end, board);
$$;

select pg_temp.reading('hero_power_best', 7554600, 49);
select pg_temp.reading('migrate_power', 27018313, null);
select pg_temp.reading('building_power', 79726100, null);

-- An unknown metric is still refused — the FK does what the CHECK did.
select throws_ok(
  $$ select pg_temp.reading('gear_power_total', 1, null) $$,
  '23503',
  NULL,
  'a metric with no registry row is refused, so a typo cannot invent a series');

-- --------------------------------------------------------- who sees what
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000cc086', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'metric-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000da086', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'metric-admin@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000cc086', 'member'),
  ('00000000-0000-4000-8000-0000000da086', 'admin');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

set local role authenticated;

-- A MEMBER. The positive first, so a view that returns nothing at all cannot pass
-- the negative by accident — 0055's lesson.
select pg_temp.act_as('00000000-0000-4000-8000-0000000cc086');

select isnt_empty(
  $$ select metric from public.player_component_power_history
      where metric = 'hero_power_best' $$,
  'a member sees the hero board reading');

-- 0109: an account component from a profile open reaches a member the same way.
select isnt_empty(
  $$ select metric from public.player_component_power_history
      where metric = 'building_power' $$,
  'a member sees the building power reading');

select is_empty(
  $$ select metric from public.player_component_power_history
      where metric = 'migrate_power' $$,
  'and does NOT see migration power — the row is not in their result at all');

-- Said separately because it is the claim that matters: not "the column is null",
-- not "the client hides it". The row is absent.
select is(
  (select count(*) from public.player_component_power_history),
  2::bigint,
  'their whole result is the two metrics they may see');

-- AN ADMIN.
select pg_temp.act_as('00000000-0000-4000-8000-0000000da086');

select isnt_empty(
  $$ select power from public.player_component_power_history
      where metric = 'migrate_power' $$,
  'an admin sees migration power');

select is(
  (select power from public.player_component_power_history where metric = 'migrate_power'),
  27018313::bigint,
  'with the figure intact');

-- A profile reading has no board behind it, so it has no denominator. Null rather
-- than a count of the observation, which for a profile sweep would be "how many
-- players were in that request" — a number that means nothing as a rank total.
select is(
  (select board_size from public.player_component_power_history
    where metric = 'migrate_power'),
  NULL::bigint,
  'and no board size, because a profile open is not a board');

reset role;
select * from finish();
rollback;
