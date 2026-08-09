-- refresh_member_roster: computed at write, and the guards that make that safe.
--
-- 0106 moved the expensive two-thirds of the members table into
-- member_roster_current, refreshed by statement triggers inside the
-- collector's own writes. 62 already proves the VIEW answers correctly on top
-- of it; this file pins the REFRESH machinery — the part that, wrong, would
-- not error but quietly serve yesterday's roster forever, or worse, an empty
-- one:
--
--   - the trigger fires: a roster batch fills the table without anyone
--     calling refresh;
--   - a newer batch prunes the departed;
--   - a caller the gate turns away (a viewer) changes nothing;
--   - a caller whose view of the world is empty (no own alliance) cannot
--     wipe a populated table — the empty guard;
--   - computed rank rides in from the newest period.
--
-- The local stack cannot exercise the service_role BYPASSRLS path or the
-- hosted RLS-under-definer behaviour (57's documented limitation, restated by
-- 0105); what it can prove is the contract every caller shares.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-000000650001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'refresh-member@test.invalid'),
  ('00000000-0000-4000-8000-000000650003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'refresh-viewer@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-000000650001', 'member'),
  ('00000000-0000-4000-8000-000000650003', 'viewer');

insert into public.collectors (collector_id, name) values
  ('00000000-0000-4000-8000-000000650c01', 'refresh probe');
insert into public.alliances (server_id, external_id, current_name) values
  (580, 'refresh-al-64', 'RefreshProbe');
update public.alliances set is_own = false where external_id <> 'refresh-al-64';

insert into public.players (game_uid, server_id, current_name)
values (650000000001, 580, 'RefAlpha'),
       (650000000002, 580, 'RefBeta');

create function pg_temp.pid(p_uid bigint) returns uuid language sql as $$
  select player_id from public.players where game_uid = p_uid;
$$;
create function pg_temp.current_ids() returns text language sql as $$
  select coalesce(string_agg(p.current_name, ',' order by p.current_name), '')
  from public.member_roster_current t
  join public.players p on p.player_id = t.player_id
  where p.current_name like 'Ref%';
$$;

-- A rank period row first, so the batch's refresh can pick the tier up.
insert into public.rank_period_snapshots
  (period_start, player_id, game_uid, name, activity_score, tier, tier_reason,
   computed_at, scoring_version)
values ('2026-08-03 02:00+00', pg_temp.pid(650000000001), 650000000001,
        'RefAlpha', 77.7, 'R3', 'test', now(), 4);

-- 1. The batch insert alone fills the table: nobody calls refresh here.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, power, presence_redacted)
select '00000000-0000-4000-8000-000000650e01', 'al.rank', 'test',
       'test:64:b1:' || v.game_uid, '2026-08-09T10:00:00Z',
       '00000000-0000-4000-8000-000000650c01', 580, a.alliance_id, 580,
       pg_temp.pid(v.game_uid), v.game_uid, v.name, v.member_rank, 1000, false
from public.alliances a,
     (values (650000000001, 'RefAlpha', 4),
             (650000000002, 'RefBeta', 1)) as v(game_uid, name, member_rank)
where a.external_id = 'refresh-al-64';

select is(pg_temp.current_ids(), 'RefAlpha,RefBeta',
  'the writing statement itself filled the summary — no explicit refresh');

-- 2. The period's verdict rode in.
select is(
  (select computed_rank from public.member_roster_current
    where player_id = pg_temp.pid(650000000001)),
  'R3', 'computed rank comes from the newest period');

select is(
  (select rank_score from public.member_roster_current
    where player_id = pg_temp.pid(650000000001)),
  77.7::numeric, 'and the score it came from rides along');

-- 3. A newer batch without Beta prunes Beta. A departure is data, and the
-- summary must not hold ghosts.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, power, presence_redacted)
select '00000000-0000-4000-8000-000000650e02', 'al.rank', 'test',
       'test:64:b2:650000000001', '2026-08-09T11:00:00Z',
       '00000000-0000-4000-8000-000000650c01', 580, a.alliance_id, 580,
       pg_temp.pid(650000000001), 650000000001, 'RefAlpha', 4, 1100, false
from public.alliances a where a.external_id = 'refresh-al-64';

select is(pg_temp.current_ids(), 'RefAlpha',
  'a member absent from the newest batch is pruned');

-- 4. A viewer calling refresh directly is turned away at the gate: nothing
-- moves, nothing is wiped.
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000650003","role":"authenticated"}', true);
select lives_ok('select public.refresh_member_roster()',
  'a viewer may call refresh without error');
reset role;

select is(pg_temp.current_ids(), 'RefAlpha',
  'and the gate made it a no-op — the table is untouched');

-- 5. The empty guard: a member whose refresh legitimately computes an empty
-- roster (no own alliance at that moment) must not empty the table either.
update public.alliances set is_own = false where external_id = 'refresh-al-64';
set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000650001","role":"authenticated"}', true);
select lives_ok('select public.refresh_member_roster()',
  'a member may refresh while no alliance is marked own');
reset role;

select is(pg_temp.current_ids(), 'RefAlpha',
  'an empty answer never replaces a populated table');

-- 6. anon cannot even ask.
select ok(
  not has_function_privilege('anon', 'public.refresh_member_roster()', 'execute'),
  'anon may not call the refresh at all');

select * from finish();
rollback;
