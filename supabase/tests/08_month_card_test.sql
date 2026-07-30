-- 0011/0016: the pass expiry reaches the secured summary, newer wins, and a
-- missing value never erases a known one.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create temp table _ids as
select (select player_id from public.players where game_uid = 58000001) as player_id,
       (select alliance_id from public.alliances limit 1) as alliance_id;

insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, month_card_expires_at)
select '00000000-0000-4000-8000-00000000d001', 'al.rank', 'test',
       'test:card:1', '2026-07-28T10:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.alliance_id, 580,
       i.player_id, 58000001, 'Holder', '2026-08-25T02:00:00Z'
from _ids i;

select is((select expires_at from public.player_month_cards m, _ids i
           where m.player_id = i.player_id),
  '2026-08-25T02:00:00Z'::timestamptz, 'the pass expiry reaches the summary');

-- A later snapshot with no pass value must not wipe it: the field is missing
-- from that response, not cleared by the game.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   name, power, month_card_expires_at)
select '00000000-0000-4000-8000-00000000d002', 'server.rank', 'test',
       'test:card:2', '2026-07-28T11:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.player_id, 580,
       58000001, 'Holder', 999, null
from _ids i;

select is((select expires_at from public.player_month_cards m, _ids i
           where m.player_id = i.player_id),
  '2026-08-25T02:00:00Z'::timestamptz, 'a null reading does not erase a known pass');
select is((select power from public.players where game_uid = 58000001), 999::bigint,
  'while the rest of the summary still advances');

-- A renewal seen later moves the expiry forward.
insert into public.player_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, player_id, server_id, game_uid,
   name, month_card_expires_at)
select '00000000-0000-4000-8000-00000000d003', 'kill.rank', 'test',
       'test:card:3', '2026-07-28T12:00:00Z',
       '00000000-0000-4000-8000-000000000c01', 580, i.player_id, 580,
       58000001, 'Holder', '2026-09-24T02:00:00Z'
from _ids i;

select is((select expires_at from public.player_month_cards m, _ids i
           where m.player_id = i.player_id),
  '2026-09-24T02:00:00Z'::timestamptz, 'a renewal advances the expiry');

select * from finish();
rollback;
