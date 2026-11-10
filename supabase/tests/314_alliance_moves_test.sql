-- 0314: alliance_moves — who joined from where, who left to where, built from
-- player_snapshots, one row per move, visibility decided inside the function.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

select has_function('public', 'alliance_moves', array['uuid', 'timestamptz'],
  'alliance_moves(p_alliance, p_since) exists');
select has_index('public', 'player_snapshots', 'player_snapshots_server_alliance_player_idx',
  'player_snapshots is indexed by server then alliance for the feed');

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-00000003aa01', 'moves-test');

-- A and B are ours (580); C is a stranger on 581; D is A relocated to 581
-- (same external_id, other server — a second alliances row, 0192).
insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code) values
  ('00000000-0000-4000-8000-00000003aaa1', 580, 'ext-mv-a', 'Ours A', 'AAA'),
  ('00000000-0000-4000-8000-00000003aaa2', 580, 'ext-mv-b', 'Ours B', 'BBB'),
  ('00000000-0000-4000-8000-00000003aaa3', 581, 'ext-mv-c', 'Theirs', 'CCC'),
  ('00000000-0000-4000-8000-00000003aaa4', 581, 'ext-mv-a', 'Ours A moved', 'AAA');
update public.alliances
   set is_own = alliance_id in ('00000000-0000-4000-8000-00000003aaa1',
                                '00000000-0000-4000-8000-00000003aaa2')
 where alliance_id in ('00000000-0000-4000-8000-00000003aaa1',
                       '00000000-0000-4000-8000-00000003aaa2',
                       '00000000-0000-4000-8000-00000003aaa3',
                       '00000000-0000-4000-8000-00000003aaa4');

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-00000003aaf1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-community@test.invalid'),
  ('00000000-0000-4000-8000-00000003aaf2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-member-a@test.invalid'),
  ('00000000-0000-4000-8000-00000003aaf3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-admin@test.invalid'),
  ('00000000-0000-4000-8000-00000003aaf4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-officer-a@test.invalid');
insert into public.app_users (user_id, role, display_name) values
  ('00000000-0000-4000-8000-00000003aaf1', 'community', 'community'),
  ('00000000-0000-4000-8000-00000003aaf2', 'member', 'member of A'),
  ('00000000-0000-4000-8000-00000003aaf3', 'admin', 'admin'),
  ('00000000-0000-4000-8000-00000003aaf4', 'officer', 'officer of A');
insert into public.alliance_memberships (user_id, alliance_id, role) values
  ('00000000-0000-4000-8000-00000003aaf2', '00000000-0000-4000-8000-00000003aaa1', 'member'),
  ('00000000-0000-4000-8000-00000003aaf4', '00000000-0000-4000-8000-00000003aaa1', 'officer')
on conflict do nothing;

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

insert into public.players (player_id, server_id, game_uid, current_name) values
  ('00000000-0000-4000-8000-00000003aab1', 580, 9700000000000001, 'Joiner'),
  ('00000000-0000-4000-8000-00000003aab2', 580, 9700000000000002, 'Leaver'),
  ('00000000-0000-4000-8000-00000003aab3', 581, 9700000000000003, 'CrossJoiner'),
  ('00000000-0000-4000-8000-00000003aab4', 580, 9700000000000004, 'Relocated'),
  ('00000000-0000-4000-8000-00000003aab5', 580, 9700000000000005, 'SeenOnce'),
  ('00000000-0000-4000-8000-00000003aab6', 580, 9700000000000006, 'Stayer'),
  ('00000000-0000-4000-8000-00000003aab7', 580, 9700000000000007, 'SameInstant'),
  ('00000000-0000-4000-8000-00000003aab8', 580, 9700000000000008, 'MovedToNowhere'),
  ('00000000-0000-4000-8000-00000003aab9', 580, 9700000000000009, 'FromUnknown');

create function pg_temp.seen(p_player uuid, p_server int, p_alliance text, p_power bigint,
                             p_at timestamptz, p_key text) returns void language sql as $$
  insert into public.player_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, player_id, server_id, game_uid,
     alliance_external_id, power)
  select gen_random_uuid(), 'server.rank', 't', 'mv:' || p_key, p_at,
         '00000000-0000-4000-8000-00000003aa01', p_server, p_player, p_server, p.game_uid,
         p_alliance, p_power
    from public.players p where p.player_id = p_player;
$$;

-- Joiner: no alliance, then A — but 100 days ago, outside the default window.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab1', 580, null, 100, now() - interval '101 days', 'b1-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab1', 580, 'ext-mv-a', 110, now() - interval '100 days', 'b1-2');
-- Leaver: A, then C on 581.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab2', 580, 'ext-mv-a', 200, '2027-04-01T00:00:00Z', 'b2-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab2', 581, 'ext-mv-c', 210, '2027-04-02T00:00:00Z', 'b2-2');
-- CrossJoiner: C on 581, then A on 580.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab3', 581, 'ext-mv-c', 300, '2027-04-01T00:00:00Z', 'b3-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab3', 580, 'ext-mv-a', 310, '2027-04-03T00:00:00Z', 'b3-2');
-- Relocated: A on 580, then the same external id on 581 (row D).
select pg_temp.seen('00000000-0000-4000-8000-00000003aab4', 580, 'ext-mv-a', 400, '2027-04-01T00:00:00Z', 'b4-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab4', 581, 'ext-mv-a', 410, '2027-04-04T00:00:00Z', 'b4-2');
-- SeenOnce: one observation in A.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab5', 580, 'ext-mv-a', 500, '2027-04-01T00:00:00Z', 'b5-1');
-- Stayer: A twice.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab6', 580, 'ext-mv-a', 600, '2027-04-01T00:00:00Z', 'b6-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab6', 580, 'ext-mv-a', 610, '2027-04-02T00:00:00Z', 'b6-2');
-- SameInstant: two boards in one capture disagree; not a move.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab7', 580, 'ext-mv-a', 700, '2027-04-01T00:00:00Z', 'b7-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab7', 580, null, 700, '2027-04-01T00:00:00Z', 'b7-2');
-- MovedToNowhere: same external id on 582, where no alliances row exists.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab8', 580, 'ext-mv-a', 800, '2027-04-01T00:00:00Z', 'b8-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab8', 582, 'ext-mv-a', 810, '2027-04-05T00:00:00Z', 'b8-2');
-- FromUnknown: an alliance we have never catalogued, then A.
select pg_temp.seen('00000000-0000-4000-8000-00000003aab9', 580, 'ext-mv-zzz', 900, '2027-04-01T00:00:00Z', 'b9-1');
select pg_temp.seen('00000000-0000-4000-8000-00000003aab9', 580, 'ext-mv-a', 910, '2027-04-06T00:00:00Z', 'b9-2');

-- ---------------------------------------------------------------------------
-- The feed for our alliance A, read by a member of A.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003aaf2');

select results_eq(
  $$ select game_uid, direction, other_alliance_tag, other_server_id, power_at
       from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
      order by game_uid $$,
  $$ values (9700000000000002::bigint, 'out'::text, 'CCC'::text, 581, 210::bigint),
            (9700000000000003::bigint, 'in'::text,  'CCC'::text, 581, 310::bigint),
            (9700000000000009::bigint, 'in'::text,  null::text,  580, 910::bigint) $$,
  'A: a leave to C, a cross-server join from C, a join from an uncatalogued alliance');

select is((select other_alliance_id from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000002), '00000000-0000-4000-8000-00000003aaa3'::uuid,
  'the other alliance resolves to its alliances row');
select is((select other_alliance_name from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000002), 'Theirs',
  'and carries its name');
select is((select player_name from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000002), 'Leaver',
  'the player''s current name rides along');
select is((select observed_at from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000002), '2027-04-02T00:00:00Z'::timestamptz,
  'observed_at is the first capture that showed the change');
select is((select other_alliance_id from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000009), null,
  'an uncatalogued alliance gives a null id but keeps its server');

select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')
            where game_uid = 9700000000000001), 0::bigint,
  'a move 100 days ago is outside the default 90-day window');
select results_eq(
  $$ select direction, other_alliance_tag, other_server_id
       from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
      where game_uid = 9700000000000001 $$,
  $$ values ('in'::text, null::text, null::int) $$,
  'with a wider window the join from no alliance shows, with no other side');

select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
            where game_uid = 9700000000000004), 0::bigint,
  'a relocation is not a leave from the old row');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
            where game_uid = 9700000000000005), 0::bigint,
  'a player seen once is no move');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
            where game_uid = 9700000000000006), 0::bigint,
  'a player who stayed is no move');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
            where game_uid = 9700000000000007), 0::bigint,
  'two boards at the same instant that disagree are no move');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01')
            where game_uid = 9700000000000008), 0::bigint,
  'relocation to a row we do not have is silent');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')), 3::bigint,
  'one row per move, nothing else');

-- The member of A asking about own alliance B: nothing.
select is_empty(
  $$ select 1 from public.alliance_moves('00000000-0000-4000-8000-00000003aaa2', '2000-01-01') $$,
  'a member of own alliance A gets no rows for own alliance B');
reset role;

-- An officer of A sees A.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003aaf4');
select isnt_empty(
  $$ select 1 from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1') $$,
  'an officer of A reads A''s feed');
reset role;

-- Community: nothing for ours, everything for a stranger.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003aaf1');
select is_empty(
  $$ select 1 from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1', '2000-01-01') $$,
  'a community account gets no rows for an own alliance');
select results_eq(
  $$ select game_uid, direction, other_alliance_tag, other_server_id
       from public.alliance_moves('00000000-0000-4000-8000-00000003aaa3')
      order by game_uid $$,
  $$ values (9700000000000002::bigint, 'in'::text,  'AAA'::text, 580),
            (9700000000000003::bigint, 'out'::text, 'AAA'::text, 580) $$,
  'the same community account reads a stranger''s feed: the join from A and the leave to A');
select results_eq(
  $$ select game_uid, direction, other_alliance_tag, other_server_id, power_at
       from public.alliance_moves('00000000-0000-4000-8000-00000003aaa4') $$,
  $$ values (9700000000000004::bigint, 'relocated'::text, 'AAA'::text, 580, 410::bigint) $$,
  'a relocated alliance lists the move under its new row, pointing at the old one');
reset role;

-- Admin reads any own alliance; B simply has no moves.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000003aaf3');
select lives_ok(
  $$ select * from public.alliance_moves('00000000-0000-4000-8000-00000003aaa2') $$,
  'admin may call for own alliance B');
select is((select count(*) from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1')), 3::bigint,
  'admin reads A''s feed in full');
reset role;

-- Anon holds nothing.
set local role anon;
select throws_ok(
  $$ select * from public.alliance_moves('00000000-0000-4000-8000-00000003aaa1') $$, '42501',
  null, 'anon cannot call alliance_moves');
reset role;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'alliance_moves' and p.prosecdef), 0::bigint,
  'alliance_moves is security invoker');

select * from finish();
rollback;
