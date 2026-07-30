-- 0013: battle report ingests follow the snapshot conventions, keep an
-- unattributed report, and are admin-only (§20.2 requires a negative test per
-- policy; §17.3 puts raw payload behind admin).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'battle_report_ingests', c.col,
  'battle_report_ingests has ' || c.col)
from unnest(array['observation_id', 'source_command', 'parser_version',
                  'idempotency_key', 'captured_at', 'raw']) as c(col);

select col_is_unique('public', 'battle_report_ingests', 'idempotency_key',
  'battle report idempotency_key is unique');

-- The observed reports are system-generated: no sender at all. A NOT NULL
-- here would have forced the parser to invent one.
select col_is_null('public', 'battle_report_ingests', 'from_game_uid',
  'from_game_uid is nullable — system reports have no sender');
select col_is_null('public', 'battle_report_ingests', 'report_content',
  'report_content is nullable — the marker can arrive without a readable body');

insert into public.battle_report_ingests
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, mail_uid, mail_type,
   from_game_uid, to_game_uid, sent_at, expires_at, report_content, report_marker)
values
  ('00000000-0000-4000-8000-00000000f201', 'mail.read.share', 'test',
   'test:report:1', '2026-07-30T18:39:26Z',
   '00000000-0000-4000-8000-000000000c01', 580, '9175367513003731', 72,
   null, 9111364514000629, '2026-07-25T22:08:21Z', '2026-08-24T22:08:21Z',
   'EPHgydr5MxjxvAgiBwj5BBjX',
   '{"c":{"battleReportSimple":{}}}'::jsonb);

select is((select from_game_uid from public.battle_report_ingests
           where idempotency_key = 'test:report:1'), null::bigint,
  'a system report stores no sender rather than a placeholder');

set local role anon;
select is_empty($$ select * from public.battle_report_ingests $$,
  'anon cannot read battle reports');
reset role;

-- Not even a signed-in member: a report exposes another player's army
-- composition, and FR-BR-008 consent does not exist yet.
set local role authenticated;
select is_empty($$ select * from public.battle_report_ingests $$,
  'an unclaimed authenticated user cannot read battle reports');
reset role;

select * from finish();
rollback;
