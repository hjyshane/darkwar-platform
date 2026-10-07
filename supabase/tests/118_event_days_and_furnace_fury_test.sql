-- 0212: declared held days, and Furnace Fury read from its member board.
--
-- Week of Monday 2026-09-28. Furnace Fury on 09-29 has a captured board with
-- Alpha on it and Bravo not; Delta is ticked absent although the board has
-- them, and the tick wins. Bio-Mutant on 10-02 is declared and nobody has
-- recorded it. Ice Pit is declared Mon/Wed/Fri by the migration itself.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values
  ('00000000-0000-4000-8000-00000000b901', 580, 'ext-ff', 'FuryTest', true, 3),
  ('00000000-0000-4000-8000-00000000b902', 580, 'ext-ff-other', 'OtherFury', false, 0);
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000b901"}');
select public.resolve_own_alliance();

insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000b101', 580, 9240000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000b102', 580, 9240000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000b104', 580, 9240000000000104, 'Delta', 70, 28);

-- One batch, one captured_at (CLAUDE.md).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000b0b1', 'al.rank', 'test',
       'test:118:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-000000000c01', 580,
       '00000000-0000-4000-8000-00000000b901', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 1, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000b101'::uuid, 9240000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000b102'::uuid, 9240000000000102::bigint, 'Bravo'),
    ('00000000-0000-4000-8000-00000000b104'::uuid, 9240000000000104::bigint, 'Delta')
  ) as v(player_id, game_uid, name);

create function pg_temp.board(key text, alliance uuid, uid bigint, day date)
returns void language sql as $$
  insert into public.furnace_fury_scores
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, game_uid, alliance_id,
     alliance_external_id, held_on, attacker, score)
  values ('00000000-0000-4000-8000-00000000b0b2', 'al.fight.act.member.score', 'test',
          'test:118:' || key, day + interval '22 hours',
          '00000000-0000-4000-8000-000000000c01', 580, 580, uid, alliance,
          'ext', day, true, 1000);
$$;

-- 09-29: Alpha and Delta on our board. Bravo only on ANOTHER alliance's board
-- that day, which must not count for them here.
select pg_temp.board('a', '00000000-0000-4000-8000-00000000b901', 9240000000000101, '2026-09-29');
select pg_temp.board('d', '00000000-0000-4000-8000-00000000b901', 9240000000000104, '2026-09-29');
select pg_temp.board('x', '00000000-0000-4000-8000-00000000b902', 9240000000000102, '2026-09-29');
-- An officer's tick overrides the board: Delta recorded absent.
insert into public.event_attendance (kind, held_on, player_id, attended)
values ('furnace_fury', '2026-09-29', '00000000-0000-4000-8000-00000000b104', false);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000b301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ff-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000b302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ff-viewer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000b301', 'member', 'ff member'),
  ('00000000-0000-4000-8000-00000000b302', 'viewer', 'ff viewer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;
create function pg_temp.tally(who text, ev text) returns jsonb language sql as $$
  select r.typed_events -> ev
    from public.member_participation('2026-09-28T02:00:00Z', '2026-10-05T02:00:00Z') r
   where r.current_name = who;
$$;

-- 1-2. The migration's own data.
select is(
  (select array_agg(held_on::text || ' ' || note order by held_on)
     from public.attendance_event_days where kind = 'ice_pit' and held_on >= '2026-09-28'),
  array['2026-09-28 Lv1', '2026-09-30 Lv2', '2026-10-02 Lv3'],
  'Ice Pit is declared Monday Lv1, Wednesday Lv2, Friday Lv3');
select ok(
  (select captured from public.attendance_event_kinds where kind = 'furnace_fury'),
  'Furnace Fury is marked captured');

select pg_temp.act_as('00000000-0000-4000-8000-00000000b301');
set local role authenticated;

-- 3-5. Furnace Fury from the board.
select is(pg_temp.tally('Alpha', 'furnace_fury'),
  '{"held": 1, "attended": 1, "missed": 0, "score": 1000}'::jsonb, 'on the board is present');
select is(pg_temp.tally('Bravo', 'furnace_fury'),
  '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb,
  'missing from our board is absent, whatever another alliance''s board says');
select is(pg_temp.tally('Delta', 'furnace_fury'),
  '{"held": 1, "attended": 0, "missed": 1, "score": null}'::jsonb, 'an officer''s tick overrides the board, and its score with it');

-- 6-7. Declared days count as held with nothing recorded.
select is(pg_temp.tally('Alpha', 'frankie'),
  '{"held": 1, "attended": 0, "missed": 0, "score": null}'::jsonb,
  'a declared day nobody recorded is held, not attended and not missed');
select is((pg_temp.tally('Alpha', 'ice_pit') ->> 'held')::int, 3,
  'three Ice Pit days in the week');

-- 8-9. Members read what is theirs, and cannot write it.
select ok((select count(*) from public.attendance_event_days) > 0,
  'a member reads the held days');
select throws_ok(
  $$ insert into public.attendance_event_days (kind, held_on) values ('ice_pit', '2026-10-03') $$,
  '42501', null, 'a member cannot declare a day');
select throws_ok(
  $$ delete from public.furnace_fury_scores $$,
  '42501', null, 'nor touch the captured board');

-- 10-11. A viewer reads nothing.
select pg_temp.act_as('00000000-0000-4000-8000-00000000b302');
select is((select count(*)::int from public.furnace_fury_scores), 0,
  'a viewer reads no board');
select is((select count(*)::int from public.attendance_event_days), 0,
  'nor the held days');
reset role;

-- 12. Anon is refused outright.
select ok(not has_table_privilege('anon', 'public.furnace_fury_scores', 'select')
          and not has_table_privilege('anon', 'public.attendance_event_days', 'select'),
  'anon has no read on either table');

select * from finish();
rollback;
