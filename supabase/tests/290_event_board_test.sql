-- 0290: one event read across its days for a page, and the verdicts it reads.
--
-- Server Clash on 2026-10-10 is typed by an officer: Alpha present with a
-- score and damage, Bravo absent, Charlie not recorded. Capital Clash on
-- 2026-10-17 has its seeded battle window; Alpha has a city inside the capital
-- during it, Bravo only outside late.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000f901', 580, 'ext-eb', 'BoardTest', true, 3);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000f901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000f101', 580, 9280000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000f102', 580, 9280000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000f103', 580, 9280000000000103, 'Charlie', 70, 28);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000f0b1', 'al.rank', 'test',
       'test:290:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000f901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000f101'::uuid, 9280000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 9280000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 9280000000000103::bigint, 'Charlie')
  ) as v(player_id, game_uid, name);

insert into public.event_attendance (kind, held_on, player_id, attended, score, damage) values
  ('server_clash', '2026-10-10', '00000000-0000-4000-8000-00000000f101', true, 5000, 777),
  ('server_clash', '2026-10-10', '00000000-0000-4000-8000-00000000f102', false, null, null);

create function pg_temp.seen(n int, at timestamptz, x int, y int)
returns void language sql as $$
  insert into public.world_city_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     point_id, x, y)
  values ('00000000-0000-4000-8000-00000000f0b2', 'world.get.new', 'test',
          'test:290:seen:' || n || ':' || at::text, at,
          '00000000-0000-4000-8000-000000000c01', 580, 580,
          ('00000000-0000-4000-8000-00000000f1' || lpad(n::text, 2, '0'))::uuid,
          9280000000000100 + n, y * 1000 + x + 1, x, y);
$$;
select pg_temp.seen(1, '2026-10-17 14:30Z', 495, 495);
select pg_temp.seen(2, '2026-10-17 15:10Z', 440, 390);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eb-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000f302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'eb-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000f301', 'member', 'eb member'),
  ('00000000-0000-4000-8000-00000000f302', 'viewer', 'eb viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.cell(kind text, day date, who text) returns text language sql as $$
  select coalesce(b.attended::text, 'unknown') || ' ' || coalesce(b.score::text, '-')
         || ' ' || coalesce(b.damage::text, '-')
    from public.event_board(kind) b
   where b.event_day = day and b.current_name = who;
$$;

select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;

-- 1-4. Server Clash is what an officer typed, with both figures.
select is(pg_temp.cell('server_clash', '2026-10-10', 'Alpha'), 'true 5000 777',
  'present with the typed score and damage');
select is(pg_temp.cell('server_clash', '2026-10-10', 'Bravo'), 'false - -',
  'ticked absent carries no figures');
select is(pg_temp.cell('server_clash', '2026-10-10', 'Charlie'), 'unknown - -',
  'nobody recorded is not known, not absent');
select is((select count(*)::int from public.event_board('server_clash')
            where event_day = '2026-10-10'), 3, 'every current member has a cell');

-- 5-6. Capital Clash is the map and the board, through the same verdicts.
select is(pg_temp.cell('capital_clash', '2026-10-17', 'Alpha'), 'true - -',
  'a city inside the capital during the battle is present');
select is(pg_temp.cell('capital_clash', '2026-10-17', 'Bravo'), 'false - -',
  'seen only outside, late, is absent');

-- 7-8. The page asks for one kind only, and an unknown kind is empty.
select is((select count(*)::int from public.event_board('frankie')
            where event_day = '2026-10-10'), 0, 'another kind does not leak in');
select is((select count(*)::int from public.event_board('no_such_event')), 0,
  'an unknown kind is empty');

-- 9. The report still tallies the same cells.
select is(
  (select r.typed_events -> 'server_clash'
     from public.member_participation('2026-10-05T02:00:00Z', '2026-10-12T02:00:00Z') r
    where r.current_name = 'Alpha'),
  '{"held": 1, "attended": 1, "missed": 0, "score": 5000, "damage": 777}'::jsonb,
  'member_participation reads the same verdict');

-- 10-11. A viewer reads no board; anon cannot call it.
select pg_temp.act_as('00000000-0000-4000-8000-00000000f302');
select is((select count(*)::int from public.event_board('server_clash')), 0,
  'a viewer reads no board');
reset role;
select ok(not has_function_privilege('anon', 'public.event_board(text)', 'execute')
          and not has_function_privilege('anon', 'public.event_verdicts(timestamptz, timestamptz)', 'execute'),
  'anon cannot call either');

-- 12. A range over 190 days returns nothing, as the report always did.
select pg_temp.act_as('00000000-0000-4000-8000-00000000f301');
set local role authenticated;
select is((select count(*)::int from public.event_verdicts('2026-01-01', '2026-12-31')), 0,
  'a range over 190 days is empty');
reset role;

select * from finish();
rollback;
