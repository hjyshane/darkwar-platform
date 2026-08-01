-- 0009: contribution snapshots follow the snapshot conventions and are not
-- readable without a role (§20.2 requires a negative test per policy).
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select has_column('public', 'alliance_contribution_snapshots', c.col,
  'alliance_contribution_snapshots has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'alliance_contribution_snapshots', 'idempotency_key',
  'contribution idempotency_key is unique');

-- 0027: a duel ranking names both alliances, so the row has to say which.
select has_column('public', 'alliance_contribution_snapshots', 'alliance_name',
  'a contribution row records the alliance it was scored for');

insert into public.alliance_contribution_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, game_uid,
   contribution_type, score, rank, score_updated_at)
values
  ('00000000-0000-4000-8000-00000000f101', 'get.daily.alliance.donate.rank', 'test',
   'test:contrib:1', '2026-07-30T04:40:00Z',
   '00000000-0000-4000-8000-000000000c01', 580, 580, 58000001,
   'daily_donation', 5860, 1, '2026-07-30T04:38:11Z');

set local role anon;
select is_empty($$ select * from public.alliance_contribution_snapshots $$,
  'anon cannot read alliance contribution');
reset role;

select * from finish();
rollback;
