-- 0214: the Watchtower level and levels gained, per member.
--
-- Week of Monday 2026-09-21. Alpha: 28 before the week, 29 and 31 inside it.
-- Bravo: read only before the week. Charlie: never read.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000d901', 580, 'ext-wt', 'TowerTest', true, 3);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000d901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000d101', 580, 9260000000000101, 'Alpha', 90, 31),
  ('00000000-0000-4000-8000-00000000d102', 580, 9260000000000102, 'Bravo', 80, 30),
  ('00000000-0000-4000-8000-00000000d103', 580, 9260000000000103, 'Charlie', 70, null);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000d0b1', 'al.rank', 'test',
       'test:120:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000d901', 580, v.player_id,
       v.game_uid, v.name, 3, null, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000d101'::uuid, 9260000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000d102'::uuid, 9260000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000d103'::uuid, 9260000000000103::bigint, 'Charlie')
  ) as v(player_id, game_uid, name);

create function pg_temp.tower(key text, who uuid, uid bigint, at timestamptz, lvl int)
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, hq_level)
  values ('00000000-0000-4000-8000-00000000d0b2', 'test.rank', 'test', 'test:120:' || key,
          at, '00000000-0000-4000-8000-000000000c01', 580, who, 580, uid, lvl);
$$;

select pg_temp.tower('a0', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-09-20T10:00:00Z', 28);
select pg_temp.tower('a1', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-09-23T10:00:00Z', 29);
select pg_temp.tower('a2', '00000000-0000-4000-8000-00000000d101', 9260000000000101, '2026-09-26T10:00:00Z', 31);
select pg_temp.tower('b0', '00000000-0000-4000-8000-00000000d102', 9260000000000102, '2026-09-10T10:00:00Z', 30);

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000d301', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wt-member@test.invalid');
insert into public.app_users (user_id, role, display_name)
values ('00000000-0000-4000-8000-00000000d301', 'member', 'wt member');
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000d301')::text, true);
set local role authenticated;

create temp table r on commit drop as
  select current_name, watchtower_level, watchtower_gained
    from public.member_participation('2026-09-21T02:00:00Z', '2026-09-28T02:00:00Z');

-- 1-2. Read before and inside the week: level now, gain against before.
select is((select watchtower_level from r where current_name = 'Alpha'), 31,
  'the level is the newest reading before the range ends');
select is((select watchtower_gained from r where current_name = 'Alpha'), 3,
  'gained is the top inside the range less the last before it');
-- 3-4. Read only before the week: a level, but no gain — a gap is not zero.
select is((select watchtower_level from r where current_name = 'Bravo'), 30,
  'a member read only before the range still has a level');
select ok((select watchtower_gained is null from r where current_name = 'Bravo'),
  'and no gain, because nothing was read inside the range');
-- 5. Never read.
select ok((select watchtower_level is null from r where current_name = 'Charlie'),
  'a member never read has no level');

-- 6. Anon still cannot call the report.
reset role;
select ok(not has_function_privilege('anon',
  'public.member_participation(timestamptz, timestamptz)', 'execute'),
  'anon cannot run the report');

select * from finish();
rollback;
