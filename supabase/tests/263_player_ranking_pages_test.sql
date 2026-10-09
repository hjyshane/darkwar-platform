-- 0263: Player Ranking pages. The merge, the paging, and the grants.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-000000000c61', 'ranking-page-test')
on conflict do nothing;

-- 580 and 581 are seeded servers.
insert into public.alliances (alliance_id, server_id, external_id, current_name)
values ('00000000-0000-4000-8000-0000000a6101', 581, 'ext-rankpage', 'RankPage');

insert into public.players (player_id, game_uid, server_id, current_name, power, kills,
                            current_alliance_id, roster_observed_at)
values
  -- on the board AND in an alliance: must appear once
  ('00000000-0000-4000-8000-0000000b6101', 6100001, 580, 'BoardAndRoster', 100, 5,
   '00000000-0000-4000-8000-0000000a6101', '2026-10-01T00:00:00Z'),
  -- roster only, below any board cut-off
  ('00000000-0000-4000-8000-0000000b6102', 6100002, 581, 'RosterOnly', 900, 7,
   '00000000-0000-4000-8000-0000000a6101', '2026-10-01T00:00:00Z'),
  -- known but in no alliance: not ranked
  ('00000000-0000-4000-8000-0000000b6103', 6100003, 581, 'Loner', 5000, 1,
   null, '2026-10-01T00:00:00Z'),
  -- alliance member with no power figure: adds nothing to a power ranking
  ('00000000-0000-4000-8000-0000000b6104', 6100004, 581, 'NoPower', null, 3,
   '00000000-0000-4000-8000-0000000a6101', '2026-10-01T00:00:00Z');

create function pg_temp.board(key text, from_server int, seen timestamptz, pw bigint)
returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid, name, power, rank)
  values ('00000000-0000-4000-8000-00000000f611', 'server.rank', 'test', key, seen,
     '00000000-0000-4000-8000-000000000c61', from_server,
     '00000000-0000-4000-8000-0000000b6101', 580, 6100001, 'BoardAndRoster', pw, 1);
$$;

-- Collector 580 saw the board twice; only the newer capture counts.
select pg_temp.board('t:rp:1', 580, '2026-10-02T00:00:00Z', 777);
select pg_temp.board('t:rp:2', 580, '2026-09-01T00:00:00Z', 1);

create temp table got on commit drop as
  select * from public.player_ranking_page('power', null, null, 'rank', false, 200, 0)
  where game_uid between 6100000 and 6100099;

select is((select count(*) from got), 2::bigint,
  'board+roster player appears once; roster-only appears; no-alliance and no-power do not');
select is((select value from got where game_uid = 6100001), 777::bigint,
  'the newest board capture wins over an older one and over the older roster figure');
select is((select source from got where game_uid = 6100002), 'roster',
  'a player below the board is included, tagged roster');
select ok((select rank from got where game_uid = 6100002) < (select rank from got where game_uid = 6100001),
  'ranks follow the figure: 900 outranks 777');

-- A later board from ANOTHER collecting server keeps the first collector's rows.
select pg_temp.board('t:rp:3', 581, '2026-10-03T00:00:00Z', 50);
select ok(exists (select 1 from public.player_ranking_merged('power')
                  where game_uid = 6100001 and source = 'board'),
  'a newer board from another collecting server does not evict the first');

-- Paging, search, filter.
select is((select count(*) from public.player_ranking_page('power', null, null, 'rank', false, 1, 0)),
  1::bigint, 'limit is honoured');
select is((select max(total) from public.player_ranking_page('power', 581, null, 'rank', false, 1, 0)),
  (select count(*) from public.player_ranking_merged('power') where server_id = 581),
  'total is the filtered count, not the page size');
select is((select count(*) from public.player_ranking_page('power', null, 'rosteronly', 'rank', false, 50, 0)),
  1::bigint, 'search matches names case-insensitively');
select is((select count(*) from public.player_ranking_page('power', null, '%', 'rank', false, 50, 0)),
  0::bigint, 'a literal percent sign is not a wildcard');

-- Grants: callable by signed-in users only.
select is(has_function_privilege('anon',
  'public.player_ranking_page(text,integer,text,text,boolean,integer,integer)', 'execute'),
  false, 'anon cannot execute the page function');
select is(has_function_privilege('authenticated',
  'public.player_ranking_page(text,integer,text,text,boolean,integer,integer)', 'execute'),
  true, 'authenticated can');

select * from finish();
rollback;
