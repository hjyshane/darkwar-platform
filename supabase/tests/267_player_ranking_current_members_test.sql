-- 0267: the Player Ranking's alliance is the current one, and ex-members do not
-- enter the ranking through an old alliance.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000c671', 'ranking-current-test');

-- CUR: 3 members expected, trusted capture lists 3 at T2; one more was last read
-- at T1 (left). PART: 10 expected, the newest capture lists only 2: not trusted.
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code, member_count) values
  ('00000000-0000-4000-8000-00000000a671', 581, 'rc-cur', 'Current', 'CUR', 3),
  ('00000000-0000-4000-8000-00000000a672', 581, 'rc-part', 'Partial', 'PART', 10);

insert into public.players (player_id, game_uid, server_id, current_name, power, kills,
                            current_alliance_id, roster_observed_at) values
  ('00000000-0000-4000-8000-00000000b671', 6710001, 581, 'In1',   900, 1, '00000000-0000-4000-8000-00000000a671', '2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b672', 6710002, 581, 'In2',   800, 1, '00000000-0000-4000-8000-00000000a671', '2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b673', 6710003, 581, 'In3',   700, 1, '00000000-0000-4000-8000-00000000a671', '2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b674', 6710004, 581, 'Gone',  600, 1, '00000000-0000-4000-8000-00000000a671', '2026-10-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b675', 6710005, 581, 'PIn1',  500, 1, '00000000-0000-4000-8000-00000000a672', '2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b676', 6710006, 581, 'PIn2',  400, 1, '00000000-0000-4000-8000-00000000a672', '2026-10-02T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b677', 6710007, 581, 'POld',  300, 1, '00000000-0000-4000-8000-00000000a672', '2026-10-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b678', 6710008, 581, 'Never', 200, 1, '00000000-0000-4000-8000-00000000a671', null);

create temp table cur on commit drop as
  select * from public.player_current_alliance()
  where player_id::text like '00000000-0000-4000-8000-00000000b67%';

select is((select count(*) from cur where alliance_id = '00000000-0000-4000-8000-00000000a671'), 4::bigint,
  'a trusted capture keeps its three listed members, and one never read from a roster');
select is((select count(*) from cur where player_id = '00000000-0000-4000-8000-00000000b674'), 0::bigint,
  'one the trusted capture does not list has left');
select is((select count(*) from cur where player_id = '00000000-0000-4000-8000-00000000b677'), 1::bigint,
  'an untrusted (2 of 10) capture sends nobody away');

create temp table got on commit drop as
  select * from public.player_ranking_page('power', 581, null, 'rank', false, 200, 0)
  where game_uid between 6710000 and 6710099;

select is((select count(*) from got where name = 'Gone'), 0::bigint,
  'an ex-member does not enter the ranking through the roster source');
select is((select count(*) from got where name = 'In1'), 1::bigint, 'a current member does');
select is((select alliance_code from got where name = 'In1'), 'CUR', 'with their current alliance');
select is((select alliance_code from got where name = 'POld'), 'PART',
  'and the last known one where the capture cannot say');

-- On the in-game board but gone from the alliance: stays ranked, no alliance.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, rank)
values (gen_random_uuid(), 'server.rank', 't', 'rc:gone', '2026-10-03T00:00:00Z',
        '00000000-0000-4000-8000-00000000c671', 581,
        '00000000-0000-4000-8000-00000000b674', 581, 6710004, 'Gone', 650, 1);
select is((select count(*) from public.player_ranking_page('power', 581, null, 'rank', false, 200, 0)
            where name = 'Gone' and alliance_code is null and source = 'board'), 1::bigint,
  'an ex-member on the in-game board stays on it, with no alliance');

select * from finish();
rollback;
