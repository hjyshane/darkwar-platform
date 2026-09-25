-- 0176: scores and roster changes typed in while the collector is down.
--
-- The promise being tested is that a captured reading ALWAYS WINS and that
-- the collector's next roster simply replaces a typed one — so most of what
-- follows writes a typed value, then a captured one, and asks which the
-- readers pick. The refusals come first because an unauthorised write here
-- would put invented numbers into somebody's rank (§20.2).
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------- set-up

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-00000000e001', 580, 'ext-manual', 'ManualTest', true, 2);
-- PINNED, not just flagged. Without a pin, resolve_own_alliance (0032)
-- re-derives `is_own` from every alliance whose roster was ever seen
-- unredacted — the seed's included — the moment the batch below lands, and
-- set_roster_membership rightly refuses to guess between two.
delete from public.app_settings where key = 'own_alliance';
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_id": "00000000-0000-4000-8000-00000000e001"}');
select public.resolve_own_alliance();
insert into public.players (player_id, server_id, game_uid, current_name, power, hq_level) values
  ('00000000-0000-4000-8000-00000000e101', 580, 9220000000000101, 'Alpha', 90, 30),
  ('00000000-0000-4000-8000-00000000e102', 580, 9220000000000102, 'Bravo', 80, 29),
  ('00000000-0000-4000-8000-00000000e103', 580, 9220000000000103, 'Charlie', 70, 28);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000e0c1', 'manual probe');

-- One batch, one captured_at (see CLAUDE.md). Alpha is 50 in it; the update
-- after it plays a server-rank reading that has since seen 90.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted, online_state)
select '00000000-0000-4000-8000-00000000e0b1', 'al.rank', 'test',
       'test:92:roster:' || v.game_uid, now() - interval '1 day',
       '00000000-0000-4000-8000-00000000e0c1', 580,
       '00000000-0000-4000-8000-00000000e001', 580, v.player_id,
       v.game_uid, v.name, v.member_rank, 30, v.power, false, 'online'
from (values
    ('00000000-0000-4000-8000-00000000e101'::uuid, 9220000000000101::bigint, 'Alpha', 4, 50::bigint),
    ('00000000-0000-4000-8000-00000000e102'::uuid, 9220000000000102::bigint, 'Bravo', 3, 80::bigint)
  ) as v(player_id, game_uid, name, member_rank, power);

-- AFTER the batch, which is the order it happens in: the roster summary
-- (0030) writes the batch's 50 onto `players` as it lands, and a later
-- reading from elsewhere is what makes `players` fresher than the batch.
-- Set before it, the 90 is simply overwritten and there is nothing fresher
-- for a copied row to take.
update public.players set power = 90
 where player_id = '00000000-0000-4000-8000-00000000e101';

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000e302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manual-member@test.invalid'),
  ('00000000-0000-4000-8000-00000000e303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manual-officer@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000000e302', 'member', 'manual member'),
  ('00000000-0000-4000-8000-00000000e303', 'officer', 'manual officer');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

-- Last week, so nothing below depends on what day the suite runs.
create function pg_temp.wk() returns timestamptz language sql as $$
  select public.reset_week_start(now()) - interval '7 days';
$$;

-- What every weekly reader asks: the newest row inside the week.
create function pg_temp.week_reading(uid bigint, kind text) returns bigint language sql as $$
  select s.score from public.alliance_contribution_snapshots s
   where s.game_uid = uid and s.contribution_type = kind
     and s.captured_at > pg_temp.wk()
     and s.captured_at <= pg_temp.wk() + interval '7 days' - interval '1 minute'
   order by s.captured_at desc limit 1;
$$;

-- ----------------------------------------------------------- the refusals

select ok(
  exists (select 1 from public.capabilities where capability = 'data.enter'),
  'data.enter is a registered capability');
select is(
  (select array_agg(role::text order by role) from public.role_permissions
    where capability = 'data.enter' and allowed),
  array['officer', 'admin'],
  'only officers and admins may type data in');

select pg_temp.act_as('00000000-0000-4000-8000-00000000e302');
set local role authenticated;

select throws_ok(
  $$ select public.enter_weekly_scores(public.reset_week_start(now()) - interval '7 days',
       '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":1}]') $$,
  '42501', null, 'a member cannot type in scores');
select throws_ok(
  $$ select public.set_roster_membership('00000000-0000-4000-8000-00000000e103', true) $$,
  '42501', null, 'a member cannot add somebody to the roster');
select throws_ok(
  $$ select public.set_roster_membership('00000000-0000-4000-8000-00000000e102', false) $$,
  '42501', null, 'a member cannot take somebody off the roster');

reset role;
select is(
  (select count(*)::int from public.alliance_contribution_snapshots
    where source_command = 'manual.contribution'),
  0, 'and the refused call wrote nothing');

-- ------------------------------------------------------------------ scores

select pg_temp.act_as('00000000-0000-4000-8000-00000000e303');

select throws_ok(
  $$ select public.enter_weekly_scores(pg_temp.wk() + interval '1 hour', '[]') $$,
  '22023', null, 'a week named by anything but its reset instant is refused');
select throws_ok(
  $$ select public.enter_weekly_scores(public.reset_week_start(now()) + interval '7 days', '[]') $$,
  '22023', null, 'a week that has not started is refused');
select throws_ok(
  $$ select public.enter_weekly_scores(pg_temp.wk(),
       '[{"player_id":"00000000-0000-4000-8000-00000000e104","duel":1}]') $$,
  '23503', null, 'a player the database has never seen is refused');
select throws_ok(
  $$ select public.enter_weekly_scores(pg_temp.wk(),
       '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":1},
         {"player_id":"00000000-0000-4000-8000-00000000e101","duel":2}]') $$,
  '23505', null, 'one member twice in one call is refused');
select throws_ok(
  $$ select public.enter_weekly_scores(pg_temp.wk(),
       '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":-5}]') $$,
  '22023', null, 'a negative score is refused');

select is(
  public.enter_weekly_scores(pg_temp.wk(),
    '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":1000,"donation":300},
      {"player_id":"00000000-0000-4000-8000-00000000e102","duel":800}]'),
  3, 'three boards written: a null donation writes nothing');

select is(pg_temp.week_reading(9220000000000101, 'alliance_battle_weekly'), 1000::bigint,
  'with nothing captured, the typed duel score is the week''s reading');
select is(pg_temp.week_reading(9220000000000101, 'weekly_donation'), 300::bigint,
  'and the typed donation');
select is(
  (select duel_weekly_score from public.player_contributions
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  1000::bigint, 'player_contributions picks the typed value up too');

-- A correction: typed again for the same week.
select public.enter_weekly_scores(pg_temp.wk(),
  '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":1200}]');
select is(pg_temp.week_reading(9220000000000101, 'alliance_battle_weekly'), 1200::bigint,
  'a second typed value for the same week replaces the first');
select is(
  (select count(*)::int from public.alliance_contribution_snapshots
    where game_uid = 9220000000000101 and source_command = 'manual.contribution'
      and contribution_type = 'alliance_battle_weekly'),
  2, 'the first typed value is kept as history, not overwritten');

-- The collector turns up, with a LOWER number captured mid-week. It still
-- wins: the rule is that a capture beats a typed value, not the bigger one.
insert into public.alliance_contribution_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, player_id, game_uid,
   contribution_type, score)
values
  ('00000000-0000-4000-8000-00000000e0b2', 'al.battle.rank.info', 'test',
   'test:92:duel:alpha', pg_temp.wk() + interval '3 days',
   '00000000-0000-4000-8000-00000000e0c1', 580, 580,
   '00000000-0000-4000-8000-00000000e101', 9220000000000101,
   'alliance_battle_weekly', 900);

select is(pg_temp.week_reading(9220000000000101, 'alliance_battle_weekly'), 900::bigint,
  'a captured reading wins over the typed one, even when it is lower');
select is(
  (select duel_weekly_score from public.player_contributions
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  900::bigint, 'and player_contributions follows the capture');

select public.enter_weekly_scores(pg_temp.wk(),
  '[{"player_id":"00000000-0000-4000-8000-00000000e101","duel":5000}]');
select is(pg_temp.week_reading(9220000000000101, 'alliance_battle_weekly'), 900::bigint,
  'typing again after a capture does not overrule it');
select is(
  (select duel_weekly_score from public.player_contributions
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  900::bigint, 'nor in player_contributions');

select is(pg_temp.week_reading(9220000000000102, 'alliance_battle_weekly'), 800::bigint,
  'a member the collector never read keeps the typed value');

-- The entry screen's reader agrees with the rank's, and says which is which.
select is(
  (select array[duel::text, duel_typed::text] from public.week_scores(pg_temp.wk())
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  array['900', 'false'], 'the entry screen shows Alpha''s captured duel score as captured');
select is(
  (select array[duel::text, duel_typed::text] from public.week_scores(pg_temp.wk())
    where player_id = '00000000-0000-4000-8000-00000000e102'),
  array['800', 'true'], 'and Bravo''s typed one as typed');

select is(
  (select count(*)::int from public.alliance_daily_contribution
    where alliance_id = '00000000-0000-4000-8000-00000000e001'
      and kind = 'alliance_battle_weekly'
      and game_day = pg_temp.wk()),
  0, 'the daily chart does not show a typed weekly total as Monday''s score');

-- ------------------------------------------------------------------ roster

create function pg_temp.roster() returns text[] language sql as $$
  select array_agg(name order by name) from public.alliance_roster_latest
   where alliance_id = '00000000-0000-4000-8000-00000000e001';
$$;

select throws_ok(
  $$ select public.set_roster_membership('00000000-0000-4000-8000-00000000e101', true) $$,
  '23505', null, 'adding somebody already on the roster is refused');
select throws_ok(
  $$ select public.set_roster_membership('00000000-0000-4000-8000-00000000e103', false) $$,
  'P0002', null, 'removing somebody who is not on it is refused');
select throws_ok(
  $$ select public.set_roster_membership('00000000-0000-4000-8000-00000000e104', true) $$,
  '23503', null, 'nor can one be added to the roster');

select is(public.set_roster_membership('00000000-0000-4000-8000-00000000e103', true), 3,
  'adding Charlie makes a roster of three');
select is(pg_temp.roster(), array['Alpha', 'Bravo', 'Charlie'],
  'the whole roster is carried forward, not just the one added');
select is(
  (select snapshot_complete from public.alliance_roster_latest
    where alliance_id = '00000000-0000-4000-8000-00000000e001' limit 1),
  true, 'and it counts as a complete roster');
select is(
  (select power from public.alliance_roster_latest
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  90::bigint, 'a copied row takes the freshest power, not the old batch''s');
select is(
  (select member_rank from public.alliance_roster_latest
    where player_id = '00000000-0000-4000-8000-00000000e101'),
  4, 'but keeps the rank the alliance gave them');

select is(public.set_roster_membership('00000000-0000-4000-8000-00000000e102', false), 2,
  'removing Bravo makes a roster of two');
select is(pg_temp.roster(), array['Alpha', 'Charlie'], 'without Bravo');
select is(
  (select confirmed from public.alliance_departures
    where alliance_id = '00000000-0000-4000-8000-00000000e001'
      and game_uid = 9220000000000102),
  true, 'Bravo reads as a confirmed departure');

-- The collector comes back and captures the real roster: Alpha and Bravo.
insert into public.alliance_member_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, alliance_id, server_id, player_id,
   game_uid, name, member_rank, hq_level, power, presence_redacted)
select '00000000-0000-4000-8000-00000000e0b3', 'al.rank', 'test',
       'test:92:roster2:' || v.game_uid, now() + interval '1 hour',
       '00000000-0000-4000-8000-00000000e0c1', 580,
       '00000000-0000-4000-8000-00000000e001', 580, v.player_id,
       v.game_uid, v.name, 3, 30, 100, false
from (values
    ('00000000-0000-4000-8000-00000000e101'::uuid, 9220000000000101::bigint, 'Alpha'),
    ('00000000-0000-4000-8000-00000000e102'::uuid, 9220000000000102::bigint, 'Bravo')
  ) as v(player_id, game_uid, name);

select is(pg_temp.roster(), array['Alpha', 'Bravo'],
  'the next captured roster replaces the typed one outright');

select * from finish();
rollback;
