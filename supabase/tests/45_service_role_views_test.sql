-- 0077: the collector reads the alliance views; browsers see exactly what they did.
--
-- The bug this fixes was silent. `alliance_departures` filters on
-- `current_app_role()` inside its WHERE clause, and a service-key request has no
-- user, so the function fell through to 'viewer' and the view returned zero rows.
-- Zero rows is what "nobody has left" looks like. The notifier announced nothing
-- and reported no error.
--
-- So the assertion that matters is not "the service role can read it" on its own —
-- it is that pair: the collector gets rows AND a browser's view of the same data
-- is unchanged. Widening a predicate is exactly the kind of fix that quietly
-- widens it too far.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cc77', 'service test', 'offline', 'test')
on conflict do nothing;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000be077', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'service-member@test.invalid'),
  ('00000000-0000-4000-8000-0000000ce077', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'service-nobody@test.invalid');
insert into public.app_users (user_id, role) values
  ('00000000-0000-4000-8000-0000000be077', 'member');

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

update public.alliances set is_own = false where is_own;
insert into public.alliances (alliance_id, server_id, external_id, current_name, is_own, member_count)
values ('00000000-0000-4000-8000-0000000ab077', 580, 'ext-svc', 'ServiceTest', true, 2);

insert into public.players (player_id, server_id, game_uid, current_name, current_alliance_id)
values
  ('00000000-0000-4000-8000-0000000cb771', 580, 9700000000000001, 'Stayed',
   '00000000-0000-4000-8000-0000000ab077'),
  ('00000000-0000-4000-8000-0000000cb772', 580, 9700000000000002, 'Left',
   '00000000-0000-4000-8000-0000000ab077');

create function pg_temp.roster(uid bigint, pid uuid, at timestamptz, who text)
returns void language sql as $$
  insert into public.alliance_member_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, server_id, game_uid, player_id,
    member_rank, power, name, presence_redacted)
  values (gen_random_uuid(), 'al.rank', 'test', 'svc:' || uid || ':' || at,
    at, '00000000-0000-4000-8000-00000000cc77', 580,
    '00000000-0000-4000-8000-0000000ab077', 580, uid, pid, 2, 100, who, false);
$$;

-- The snapshot's `name` is what `last_known_name` comes from, and what the
-- message says. Omitting it the first time made this test fail with NULL, which
-- is the same thing the notifier would have posted as "UID 9700…".
--
-- Both present in the first batch; only one in the second. That second batch has
-- to be COMPLETE against the game's count of 2, or 0067 calls the absence
-- unconfirmed and the departure is a maybe.
select pg_temp.roster(9700000000000001, '00000000-0000-4000-8000-0000000cb771',
  '2026-08-01T05:00:00Z', 'Stayed');
select pg_temp.roster(9700000000000002, '00000000-0000-4000-8000-0000000cb772',
  '2026-08-01T05:00:00Z', 'Left');
select pg_temp.roster(9700000000000001, '00000000-0000-4000-8000-0000000cb771',
  '2026-08-05T05:00:00Z', 'Stayed');
update public.alliances set member_count = 1
where alliance_id = '00000000-0000-4000-8000-0000000ab077';

-- ------------------------------------------------------------- the collector
-- Not wrapped in `set role`: pgTAP runs as the migration owner, which
-- `is_service_request()` accepts for the same reason it accepts service_role —
-- both are the collector's side of the boundary rather than a browser's.
select is(
  (select count(*) from public.alliance_departures
    where alliance_id = '00000000-0000-4000-8000-0000000ab077'),
  1::bigint,
  'the collector sees the departure — it saw zero before 0077, which reads as nobody left');

select is(
  (select last_known_name from public.alliance_departures
    where alliance_id = '00000000-0000-4000-8000-0000000ab077'),
  'Left',
  'and it is the member who actually went');

select isnt(
  (select count(*) from public.alliance_roster_latest
    where alliance_id = '00000000-0000-4000-8000-0000000ab077'),
  0::bigint,
  'and it can read the roster the departure was derived from');

select ok(public.is_service_request(), 'is_service_request is true on this side');

-- ---------------------------------------------------------------- the member
-- The half that proves the predicate did not open too far. A member's answer must
-- be identical to what it was before, not merely non-empty.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-0000000be077');

select ok(not public.is_service_request(), 'and false for a browser request');

select is(
  (select count(*) from public.alliance_departures
    where alliance_id = '00000000-0000-4000-8000-0000000ab077'),
  1::bigint,
  'a member still sees the departure, as they did before');

select isnt(
  (select count(*) from public.alliance_roster_latest
    where alliance_id = '00000000-0000-4000-8000-0000000ab077'),
  0::bigint,
  'and still sees the roster');

-- -------------------------------------------------------------- the outsider
-- Signed in, no app_users row. Widening a predicate must not have reached them.
select pg_temp.act_as('00000000-0000-4000-8000-0000000ce077');

select is(
  (select count(*) from public.alliance_departures),
  0::bigint,
  'somebody with no app_users row still sees no departures');

select is(
  (select count(*) from public.alliance_roster_history),
  0::bigint,
  'nor any roster history — the widening did not reach them');

reset role;

select * from finish();
rollback;
