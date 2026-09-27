-- 0184: a weekly duel board nobody opened, rebuilt from the round total.
--
-- Three rounds, all well in the past so nothing depends on the day the suite
-- runs, and far enough back that no other fixture has a board in them:
--   r1 - week 0 missing, recovered from a round/weekly pair in week 1
--   r2 - the same, but one member comes out negative: nothing is written
--   r3 - week 1 missing, recovered from week 1's own frozen round reading
--        minus week 0's final
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------- set-up

insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-00000000f101', 580, 9990000000000101, 'DuelA'),
  ('00000000-0000-4000-8000-00000000f102', 580, 9990000000000102, 'DuelB'),
  ('00000000-0000-4000-8000-00000000f103', 580, 9990000000000103, 'DuelC'),
  ('00000000-0000-4000-8000-00000000f104', 580, 9990000000000104, 'DuelD');

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000000f0c1', 'duel derive probe');

create function pg_temp.r1() returns timestamptz language sql as $$
  select public.reset_week_start(now()) - interval '70 days';
$$;
create function pg_temp.r2() returns timestamptz language sql as $$
  select pg_temp.r1() - interval '28 days';
$$;
create function pg_temp.r3() returns timestamptz language sql as $$
  select pg_temp.r1() - interval '56 days';
$$;

-- One board reading for one member. Readings passed the same `at` are one
-- batch, which is how the collector writes them.
create function pg_temp.board(kind text, at timestamptz, uid bigint, score bigint)
returns void language sql as $$
  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, server_id, player_id, game_uid,
     contribution_type, score)
  select gen_random_uuid(), 'al.battle.rank.info', 'test',
         'test:99:' || kind || ':' || uid || ':' || extract(epoch from at),
         at, '00000000-0000-4000-8000-00000000f0c1', 580, 580, p.player_id, uid,
         kind, score
    from public.players p where p.game_uid = uid;
$$;

-- What every weekly reader asks: the newest row inside the week.
create function pg_temp.week_reading(uid bigint, ws timestamptz) returns bigint language sql as $$
  select s.score from public.alliance_contribution_snapshots s
   where s.game_uid = uid and s.contribution_type = 'alliance_battle_weekly'
     and s.captured_at > ws and s.captured_at <= ws + interval '7 days'
   order by s.captured_at desc limit 1;
$$;

create function pg_temp.derived_in(ws timestamptz) returns int language sql as $$
  select count(*)::int from public.alliance_contribution_snapshots
   where source_command = 'derived:round-total'
     and captured_at > ws and captured_at <= ws + interval '7 days';
$$;

-- ------------------------------------------------------------ the refusal

set local role authenticated;
select throws_ok(
  $$ select internal.derive_duel_round(now()) $$,
  '42501', null, 'nobody signed in can run the derivation');
reset role;

-- ------------------------------------------------------------------- r1
-- Week 0 never captured. Week 1 has two pairs: a mid-week one whose boards
-- were still moving, and a Sunday one after the duel ended. C is on the round
-- board but missing from week 1's weekly batch.

-- Mid-week pair: would make A 500.
select pg_temp.board('alliance_battle_round',  pg_temp.r1() + interval '9 days', 9990000000000101, 700);
select pg_temp.board('alliance_battle_weekly', pg_temp.r1() + interval '9 days' + interval '20 seconds', 9990000000000101, 200);

-- Sunday pair.
select pg_temp.board('alliance_battle_round', pg_temp.r1() + interval '13 days 3 hours', v.uid, v.score)
  from (values (9990000000000101::bigint, 1000::bigint), (9990000000000102, 500),
               (9990000000000103, 300), (9990000000000104, 100)) as v(uid, score);
select pg_temp.board('alliance_battle_weekly', pg_temp.r1() + interval '13 days 3 hours 30 seconds', v.uid, v.score)
  from (values (9990000000000101::bigint, 400::bigint), (9990000000000102, 500),
               (9990000000000104, 50)) as v(uid, score);

-- Week 2 was captured; week 3 has nothing to derive it from.
select pg_temp.board('alliance_battle_weekly', pg_temp.r1() + interval '15 days', 9990000000000101, 80);

select is(internal.derive_duel_round(pg_temp.r1()), 3,
  'three members of week 0 are derived: the one missing from a board is not');
select is(pg_temp.week_reading(9990000000000101, pg_temp.r1()), 600::bigint,
  'week 0 is the round total less week 1, from the pair taken after the duel ended');
select is(pg_temp.week_reading(9990000000000102, pg_temp.r1()), 0::bigint,
  'a member who scored nothing in week 0 reads zero, not absent');
select is(pg_temp.week_reading(9990000000000103, pg_temp.r1()), null::bigint,
  'a member absent from the weekly board is skipped rather than assumed zero');
select is(
  (select min(captured_at) from public.alliance_contribution_snapshots
    where source_command = 'derived:round-total' and game_uid = 9990000000000101),
  pg_temp.r1() + interval '30 seconds',
  'the derived row is stamped just after the reset, so any capture is newer');
select is(pg_temp.derived_in(pg_temp.r1() + interval '7 days') + pg_temp.derived_in(pg_temp.r1() + interval '14 days')
          + pg_temp.derived_in(pg_temp.r1() + interval '21 days'), 0,
  'weeks that were captured, or have nothing to subtract from, get nothing');

select is(internal.derive_duel_round(pg_temp.r1()), 0,
  'running it again changes nothing');
select is(pg_temp.derived_in(pg_temp.r1()), 3, 'and adds no rows');

-- A capture of week 0 turns up after all.
select pg_temp.board('alliance_battle_weekly', pg_temp.r1() + interval '3 days', 9990000000000101, 650);
select is(pg_temp.week_reading(9990000000000101, pg_temp.r1()), 650::bigint,
  'a real capture of the week wins over the derived figure');

-- Even a better pair no longer reaches a week that has been captured.
select pg_temp.board('alliance_battle_round', pg_temp.r1() + interval '13 days 5 hours', 9990000000000101, 1001);
select pg_temp.board('alliance_battle_weekly', pg_temp.r1() + interval '13 days 5 hours', 9990000000000101, 400);
select is(internal.derive_duel_round(pg_temp.r1()), 0,
  'once a week has a capture, nothing more is derived for it');

-- ------------------------------------------------------------------- r2
-- D's weekly figure exceeds its round total: the round is not what the
-- arithmetic assumes, and the whole week is left alone.

select pg_temp.board('alliance_battle_round', pg_temp.r2() + interval '13 days 3 hours', v.uid, v.score)
  from (values (9990000000000101::bigint, 1000::bigint), (9990000000000104, 100)) as v(uid, score);
select pg_temp.board('alliance_battle_weekly', pg_temp.r2() + interval '13 days 3 hours', v.uid, v.score)
  from (values (9990000000000101::bigint, 400::bigint), (9990000000000104, 150)) as v(uid, score);

select is(internal.derive_duel_round(pg_temp.r2()), 0,
  'one negative member means nobody in that week is derived');
select is(pg_temp.derived_in(pg_temp.r2()), 0, 'and no row is written');

-- ------------------------------------------------------------------- r3
-- Week 0 captured on its Sunday; week 1 never opened, but its round board was,
-- after the duel ended. A mid-week round reading in week 1 is not final and
-- must not be used on its own.

select pg_temp.board('alliance_battle_weekly', pg_temp.r3() + interval '6 days 5 hours', 9990000000000101, 100);
select pg_temp.board('alliance_battle_round', pg_temp.r3() + interval '10 days', 9990000000000101, 200);

select is(internal.derive_duel_round(pg_temp.r3()), 0,
  'a round reading from before the duel ended does not settle its own week');

select pg_temp.board('alliance_battle_round', pg_temp.r3() + interval '13 days 4 hours', 9990000000000101, 350);

select is(internal.derive_duel_round(pg_temp.r3()), 1,
  'after the duel ends, the round reading settles the week it was taken in');
select is(pg_temp.week_reading(9990000000000101, pg_temp.r3() + interval '7 days'), 250::bigint,
  'week 1 is the round total less week 0''s final');

select * from finish();
rollback;
