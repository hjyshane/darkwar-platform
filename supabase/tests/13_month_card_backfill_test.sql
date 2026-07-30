-- 0017: the raw backfill obeys the parser's rules — sentinels and
-- millisecond values are refused, real seconds become the pass.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

create temp table _ids as
select (select player_id from public.players where game_uid = 58000001) as p1,
       (select player_id from public.players where game_uid = 58000002) as p2,
       (select alliance_id from public.alliances limit 1) as alliance_id;

-- Four pre-promotion rows (typed column NULL, value only in raw):
-- a real expiry, the two sentinels, and a millisecond-magnitude confusion.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, raw)
select v.obs, 'al.rank', '1.0.0', v.key, v.seen,
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       v.pid, v.uid, v.name, v.raw
from _ids i,
lateral (values
  ('00000000-0000-4000-8000-00000000e001'::uuid, 'test:bf:1',
   '2026-07-30T02:48:55Z'::timestamptz, i.p1, 58000001::bigint, 'Holder',
   '{"monthCardEndTime": 1787623200}'::jsonb),
  ('00000000-0000-4000-8000-00000000e002'::uuid, 'test:bf:2',
   '2026-07-30T02:48:55Z'::timestamptz, i.p2, 58000002::bigint, 'NoPass',
   '{"monthCardEndTime": -1}'::jsonb),
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'test:bf:3',
   '2026-07-30T02:48:56Z'::timestamptz, i.p2, 58000002::bigint, 'NoPass',
   '{"monthCardEndTime": 0}'::jsonb),
  ('00000000-0000-4000-8000-00000000e004'::uuid, 'test:bf:4',
   '2026-07-30T02:48:57Z'::timestamptz, i.p2, 58000002::bigint, 'NoPass',
   '{"monthCardEndTime": 1785636000000}'::jsonb)
) as v(obs, key, seen, pid, uid, name, raw);

select lives_ok('select * from public.backfill_month_card_from_raw()',
  'the backfill runs');

select is((select month_card_expires_at from public.alliance_member_snapshots
           where idempotency_key = 'test:bf:1'),
  '2026-08-25T02:00:00Z'::timestamptz, 'epoch seconds become the expiry');

select is((select count(*)::int from public.alliance_member_snapshots
           where idempotency_key in ('test:bf:2','test:bf:3','test:bf:4')
             and month_card_expires_at is not null), 0,
  'sentinels (-1, 0) and millisecond values stay null');

select is((select expires_at from public.player_month_cards m, _ids i
           where m.player_id = i.p1),
  '2026-08-25T02:00:00Z'::timestamptz, 'the pass reaches the secured summary');

select is((select count(*)::int from public.player_month_cards m, _ids i
           where m.player_id = i.p2), 0,
  'a player with only refused readings gets no card row');

select lives_ok('select * from public.backfill_month_card_from_raw()',
  'running it again is a no-op');

select throws_ok($$ select public.backfill_month_card_from_raw() $$, '42501', null,
  'clients cannot call the backfill — it interprets raw, which 0016 hid'
) from (select set_config('role', 'authenticated', true)) _;
reset role;

select * from finish();
rollback;
