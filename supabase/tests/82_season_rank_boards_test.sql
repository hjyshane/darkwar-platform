-- 0136: the two season boards follow the snapshot conventions, stay
-- member-only, and refuse a server nobody has registered.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

select has_column('public', 'alliance_season_score_snapshots', c.col,
  'alliance_season_score_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select has_column('public', 'player_season_force_snapshots', c.col,
  'player_season_force_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'alliance_season_score_snapshots', 'idempotency_key',
  'alliance season score idempotency_key is unique');
select col_is_unique('public', 'player_season_force_snapshots', 'idempotency_key',
  'player season force idempotency_key is unique');

-- The alliance board reaches outside the tracked group. 584 is in the seed
-- (577-584); the observed response also carried 586 and 588, which are not.
create function pg_temp.al_board(key text, srv int, ext text, sc bigint,
                                 rnk int, oldrnk int)
returns void language sql as $$
  insert into public.alliance_season_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id,
     alliance_external_id, alliance_name, alliance_abbr,
     score, power, rank, previous_rank)
  values
    ('00000000-0000-4000-8000-00000000f501', 'get.alliance.season.score.rank', 'test',
     key, '2026-08-20T09:25:00Z', '00000000-0000-4000-8000-000000000c01', 580, srv,
     ext, 'Test Alliance', 'TST', sc, 900000000, rnk, oldrnk);
$$;

select pg_temp.al_board('t:sas:1', 580, '0123456789abcdef0123456789abcdef',
                        1200, 1, 3);
select pg_temp.al_board('t:sas:2', 584, 'fedcba9876543210fedcba9876543210',
                        900, 2, 1);

select is((select count(*)::int from public.alliance_season_score_snapshots
           where idempotency_key like 't:sas:%'), 2,
  'the alliance board holds rows from more than one server');

-- alliance_id is nullable on purpose: an alliance on an untracked server
-- has no local identity row, and the board must still land.
select is((select alliance_id from public.alliance_season_score_snapshots
           where idempotency_key = 't:sas:1'), null::uuid,
  'an alliance board row lands without a resolved alliance_id');

-- oldRank is the server's own number, kept rather than recomputed.
select is((select previous_rank from public.alliance_season_score_snapshots
           where idempotency_key = 't:sas:1'), 3,
  'the board keeps the previous rank the server sent');

-- The guard that matters for this board: an unregistered server must be
-- refused, because that refusal is what forces sync's ensure_servers() to
-- register 586/588 as untracked instead of the row silently naming a server
-- the rest of the schema knows nothing about.
select throws_ok($$
  insert into public.alliance_season_score_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id,
     alliance_external_id, score, rank)
  values
    ('00000000-0000-4000-8000-00000000f502', 'get.alliance.season.score.rank', 'test',
     't:sas:3', '2026-08-20T09:25:00Z', '00000000-0000-4000-8000-000000000c01',
     580, 9999, 'deadbeefdeadbeefdeadbeefdeadbeef', 10, 9)
$$, '23503', null, 'a season board row naming an unregistered server is refused');

insert into public.player_season_force_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid,
   name, alliance_abbr, force, rank)
values
  ('00000000-0000-4000-8000-00000000f503', 'desert.force.server.rank', 'test',
   't:psf:1', '2026-08-20T09:26:00Z', '00000000-0000-4000-8000-000000000c01',
   580, 580, 1327205044000580, 'Ranked002', 'TST', 4200, 7);

select is((select force from public.player_season_force_snapshots
           where idempotency_key = 't:psf:1'), 4200::bigint,
  'the player board keeps its force reading');

-- 0065: nothing in this app is public. anon holds no grant, so it fails
-- loudly rather than reading an empty list. 34_no_public_read_test covers
-- the general rule; these two assert it for the tables added here.
set local role anon;
select throws_ok($$ select snapshot_id from public.alliance_season_score_snapshots $$,
  '42501', null, 'anon reads no alliance season board');
select throws_ok($$ select snapshot_id from public.player_season_force_snapshots $$,
  '42501', null, 'anon reads no player season board');
reset role;

select * from finish();
rollback;
