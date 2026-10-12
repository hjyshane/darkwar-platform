-- 0285: community reads the alliance and player pages, and not ours.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000fd001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cm2@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000fd001', 'community');

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000fda01', 580, 'ext-c2-own', 'Ours', 'OWN'),
  ('00000000-0000-4000-8000-0000000fda02', 581, 'ext-c2-other', 'Theirs', 'OTH');

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-0000000fdc01', 'c2 probe');
insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000fdb01', 580, 9700000001000580, 'OurPerson',
   '00000000-0000-4000-8000-0000000fda01'),
  ('00000000-0000-4000-8000-0000000fdb02', 581, 9700000002000581, 'TheirPerson',
   '00000000-0000-4000-8000-0000000fda02');

insert into public.player_component_power_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   metric, power, rank, board_type, raw)
select '00000000-0000-4000-8000-0000000fde01', 'rank.get.by.range', 1,
       'test:c2:' || v.uid, '2026-08-08T12:00:00Z',
       '00000000-0000-4000-8000-0000000fdc01', 580, v.pid, v.srv, v.uid,
       'hero_power_total', 900000, 1, 1, '{}'::jsonb
from (values ('00000000-0000-4000-8000-0000000fdb01'::uuid, 580, 9700000001000580::bigint),
             ('00000000-0000-4000-8000-0000000fdb02'::uuid, 581, 9700000002000581::bigint))
     as v(pid, srv, uid);

update public.alliances set is_own = (alliance_id = '00000000-0000-4000-8000-0000000fda01')
where alliance_id in ('00000000-0000-4000-8000-0000000fda01',
                      '00000000-0000-4000-8000-0000000fda02');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000fd001","role":"authenticated"}', true);

select is(
  (select count(*) from public.player_component_power_history
    where player_id = '00000000-0000-4000-8000-0000000fdb02'),
  1::bigint, 'community reads a stranger''s component history');

select is(
  (select count(*) from public.player_component_power_history
    where player_id = '00000000-0000-4000-8000-0000000fdb01'),
  0::bigint, 'and none of a player whose last-known alliance is ours');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual like '%community%'
      and tablename in ('alliance_growth_current', 'alliance_board_readings')),
  2::bigint, 'the alliance page''s growth and board tables name community');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and cmd = 'SELECT' and qual like '%community%'
      and tablename in ('player_contributions', 'player_presence', 'member_roster_current')),
  0::bigint, 'and the alliance-internal ones still do not');

select is(
  (select count(*) from public.alliance_roster_latest),
  0::bigint, 'the roster view is still closed to community');

reset role;
select * from finish();
rollback;
