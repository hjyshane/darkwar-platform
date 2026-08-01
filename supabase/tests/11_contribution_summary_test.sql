-- Contribution snapshots project into the current-state table, newer wins,
-- and the two types do not gate each other.
--
-- 0015 wrote these onto public.players; 0020 moved them to
-- public.player_contributions because players is world-readable. The
-- scenarios below are unchanged — they pin the trigger's newer-wins
-- behaviour, which had to be rewritten as an upsert to follow.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-000000000c11', 'summary-test')
on conflict do nothing;

insert into public.players (player_id, game_uid, server_id, current_name)
values ('00000000-0000-4000-8000-0000000da001'::uuid, 58011111000580, 580, 'Donor')
on conflict do nothing;

-- pgTAP-side helper: one insert per scenario.
create function pg_temp.contrib(
  key text, ctype text, cscore bigint, seen timestamptz, changed timestamptz
) returns void language sql as $$
  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     contribution_type, score, score_updated_at)
  values
    ('00000000-0000-4000-8000-00000000f301', 'get.daily.alliance.donate.rank', 'test',
     key, seen, '00000000-0000-4000-8000-000000000c11', 580, 580,
     '00000000-0000-4000-8000-0000000da001'::uuid, 58011111000580,
     ctype, cscore, changed);
$$;

select pg_temp.contrib('t:c:1', 'daily_donation', 5860,
                       '2026-07-30T04:40:00Z', '2026-07-30T04:38:11Z');

select is((select daily_donation_score from public.player_contributions
           where player_id = '00000000-0000-4000-8000-0000000da001'), 5860::bigint,
  'daily donation lands in the current-state table');
select is((select daily_donation_updated_at from public.player_contributions
           where player_id = '00000000-0000-4000-8000-0000000da001'),
          '2026-07-30T04:38:11Z'::timestamptz,
  'updated_at prefers the server''s score_updated_at over captured_at');

-- An OLDER reading arriving later (replay) must not overwrite.
select pg_temp.contrib('t:c:2', 'daily_donation', 100,
                       '2026-07-29T04:40:00Z', '2026-07-29T04:38:11Z');
select is((select daily_donation_score from public.player_contributions
           where player_id = '00000000-0000-4000-8000-0000000da001'), 5860::bigint,
  'an older replayed snapshot does not overwrite a newer score');

-- The other type has its own clock: an alliance_battle reading older than
-- the daily one must still land, because they gate independently.
select pg_temp.contrib('t:c:3', 'alliance_battle_weekly', 42000,
                       '2026-07-29T10:00:00Z', '2026-07-29T09:59:00Z');
select is((select duel_weekly_score from public.player_contributions
           where player_id = '00000000-0000-4000-8000-0000000da001'), 42000::bigint,
  'the weekly duel is not gated by the daily donation timestamp');

-- A null score on a newer sighting advances the clock without erasing.
select pg_temp.contrib('t:c:4', 'daily_donation', null,
                       '2026-07-30T05:40:00Z', '2026-07-30T05:38:00Z');
select is((select daily_donation_score from public.player_contributions
           where player_id = '00000000-0000-4000-8000-0000000da001'), 5860::bigint,
  'a null score never erases a known one');

select is((select last_seen_at >= '2026-07-30T05:40:00Z'::timestamptz
           from public.players where game_uid = 58011111000580), true,
  'a contribution sighting advances last_seen_at');

select has_column('public', 'player_contributions', 'duel_round_updated_at',
  'each duel board has its own updated_at');

select * from finish();
rollback;
