-- 0228: a player_snapshots insert refreshes the members it names and nothing
-- else. A stale member row is corrected by a snapshot of that member, left
-- alone by a snapshot of someone outside the alliance, and a member's row
-- whose figures did not change is not rewritten.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-000000a30c01', 'player refresh probe');
insert into public.alliances (server_id, external_id, current_name) values
  (580, 'refresh-al-130', 'PlayerRefreshProbe');
update public.alliances set is_own = (external_id = 'refresh-al-130');

insert into public.players (game_uid, server_id, current_name)
values (730000000001, 580, 'PrMember'),
       (730000000002, 581, 'PrStranger');

create function pg_temp.pid(p_uid bigint) returns uuid language sql as $$
  select player_id from public.players where game_uid = p_uid;
$$;

create function pg_temp.snap(key text, uid bigint) returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid,
     name, power, rank)
  values ('00000000-0000-4000-8000-000000a30e01', 'server.rank', 'test', key,
          now(), '00000000-0000-4000-8000-000000a30c01', 580, pg_temp.pid(uid),
          580, uid, 'x', 1000, 1);
$$;

insert into public.rank_period_snapshots
  (period_start, player_id, game_uid, name, activity_score, tier, tier_reason,
   computed_at, scoring_version)
values ('2026-08-03 02:00+00', pg_temp.pid(730000000001), 730000000001,
        'PrMember', 55.5, 'R3', 'test', now(), 4);

-- The roster batch puts the member on the table (its own full refresh).
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, power, presence_redacted)
select '00000000-0000-4000-8000-000000a30e02', 'al.rank', 'test', 'test:130:roster',
       now(), '00000000-0000-4000-8000-000000a30c01', 580, a.alliance_id, 580,
       pg_temp.pid(730000000001), 730000000001, 'PrMember', 3, 1000, false
from public.alliances a where a.external_id = 'refresh-al-130';

select is(
  (select computed_rank from public.member_roster_current
    where player_id = pg_temp.pid(730000000001)),
  'R3', 'the member is on the table');

-- Make the member's row stale, as if a refresh had been missed.
update public.member_roster_current
   set computed_rank = 'stale', refreshed_at = '2000-01-01'
 where player_id = pg_temp.pid(730000000001);

-- 1. A snapshot of a non-member touches nothing on the members table.
select pg_temp.snap('test:130:stranger', 730000000002);
select is(
  (select computed_rank from public.member_roster_current
    where player_id = pg_temp.pid(730000000001)),
  'stale', 'a snapshot of someone outside the alliance refreshes nothing');

-- 2. A snapshot of the member corrects that member's row.
select pg_temp.snap('test:130:member', 730000000001);
select is(
  (select computed_rank from public.member_roster_current
    where player_id = pg_temp.pid(730000000001)),
  'R3', 'a snapshot of the member refreshes that member');

-- 3. A refresh that finds nothing changed leaves the row as it is.
select is(
  (select refreshed_at from public.member_roster_current
    where player_id = pg_temp.pid(730000000001)) > '2000-01-02'::timestamptz,
  true, 'the corrected row was rewritten once');
update public.member_roster_current set refreshed_at = '2001-01-01'
 where player_id = pg_temp.pid(730000000001);
-- (A new snapshot does move the member's "growth since last", so the
-- no-change case is a second refresh with nothing new.)
select public.refresh_member_roster_players(array[pg_temp.pid(730000000001)]);
select is(
  (select refreshed_at from public.member_roster_current
    where player_id = pg_temp.pid(730000000001)),
  '2001-01-01'::timestamptz, 'an unchanged member row is not rewritten');

-- 4. anon cannot call the targeted refresh.
select ok(
  not has_function_privilege('anon', 'public.refresh_member_roster_players(uuid[])', 'execute'),
  'anon may not call the targeted refresh');

select * from finish();
rollback;
