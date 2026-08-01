-- 0024: presence projects from roster snapshots into player_presence.
--
-- The interesting cases are the two ways this could quietly lose information:
-- a replayed older snapshot overwriting newer presence, and a redacted
-- snapshot — where the server reports everyone online with offLineTime 0 —
-- erasing a known state under the guise of an update.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create temp table _ids as
select
  (select player_id from public.players where game_uid = 58000001) as player_id,
  (select alliance_id from public.alliances limit 1) as alliance_id;

create function pg_temp.roster(
  key text, seen timestamptz, state text, since timestamptz, redacted boolean
) returns void language sql as $$
  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, alliance_id, server_id, player_id,
     game_uid, online_state, offline_since, presence_redacted)
  select '00000000-0000-4000-8000-00000000e401', 'al.rank', 'test',
         key, seen, '00000000-0000-4000-8000-000000000c01', 580,
         i.alliance_id, 580, i.player_id, 58000001, state, since, redacted
  from _ids i;
$$;

-- Offline member: the timestamp is the real one, and observed_at records
-- when we were told, so a reader can say "offline since X, as of Y".
select pg_temp.roster('t:p:1', '2026-07-28T00:17:20Z', 'offline',
                      '2026-07-27T09:12:45Z', false);

select is((select online_state from public.player_presence where player_id =
           (select player_id from _ids)), 'offline',
  'roster presence projects into the current-state table');
select is((select offline_since from public.player_presence where player_id =
           (select player_id from _ids)), '2026-07-27T09:12:45Z'::timestamptz,
  'offline_since is the game''s value, not when we looked');
select is((select observed_at from public.player_presence where player_id =
           (select player_id from _ids)), '2026-07-28T00:17:20Z'::timestamptz,
  'observed_at is the snapshot''s captured_at');

-- players.last_seen_at is a different fact and must stay that way: it is the
-- freshness signal the dashboard badges, not a presence claim.
select isnt((select last_seen_at from public.players where game_uid = 58000001),
            '2026-07-27T09:12:45Z'::timestamptz,
  'last_seen_at is not overwritten with the offline time');

-- A replayed OLDER snapshot must not overwrite newer presence.
select pg_temp.roster('t:p:2', '2026-07-27T00:00:00Z', 'online', null, false);

select is((select online_state from public.player_presence where player_id =
           (select player_id from _ids)), 'offline',
  'an older replayed snapshot does not overwrite newer presence');

-- A redacted snapshot carries no presence. It must be skipped, not written:
-- opening another alliance's roster would otherwise blank out what we knew.
select pg_temp.roster('t:p:3', '2026-07-29T00:00:00Z', null, null, true);

select is((select online_state from public.player_presence where player_id =
           (select player_id from _ids)), 'offline',
  'a redacted snapshot does not erase known presence');
select is((select observed_at from public.player_presence where player_id =
           (select player_id from _ids)), '2026-07-28T00:17:20Z'::timestamptz,
  'and does not advance observed_at either');

-- Coming back online clears the timestamp rather than leaving a stale one.
select pg_temp.roster('t:p:4', '2026-07-30T00:00:00Z', 'online', null, false);

select is((select offline_since from public.player_presence where player_id =
           (select player_id from _ids)), null::timestamptz,
  'coming back online clears offline_since');

select * from finish();
rollback;
