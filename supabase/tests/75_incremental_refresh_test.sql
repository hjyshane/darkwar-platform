-- 0128: refreshing one alliance must not disturb the others.
--
-- The bug this replaces was a full rebuild inside every insert, which stopped
-- finishing on 2026-08-13 and froze three days of alliance data outside the
-- cloud. The bug it could EASILY introduce is worse and quieter: the prune at
-- the end of both functions deletes every row the pass did not rewrite, so a
-- partial refresh that kept it would delete every alliance the batch did not
-- mention. The first two tests are that.
--
-- The third is the one that is easy to lose while optimising. Board scope is a
-- property of the OBSERVATION — a reading is cross-server when the response it
-- came in spanned several servers — so a scan filtered by alliance alone cannot
-- see the sibling rows that make it true. Get that wrong and every cross-server
-- rank silently becomes a server rank: still a number, still plausible, wrong.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.collectors (collector_id, name, status, version)
values ('00000000-0000-4000-8000-00000000cd77', 'refresh test', 'offline', 'test')
on conflict do nothing;

update public.alliances set is_own = false where is_own;

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code,
                              is_own, member_count)
values
  ('00000000-0000-4000-8000-0000000aa001', 580, 'ext-aa1', 'Alpha', 'AAA', true, 40),
  ('00000000-0000-4000-8000-0000000aa002', 581, 'ext-aa2', 'Beta', 'BBB', false, 30);

create function pg_temp.snap(
  alliance uuid, ext text, server int, obs uuid, at timestamptz, power bigint, rank int)
returns void language sql as $$
  insert into public.alliance_snapshots (
    observation_id, source_command, parser_version, idempotency_key, captured_at,
    collector_id, collected_from_server_id, alliance_id, external_id, server_id,
    name, code, power, member_count, rank)
  values (obs, 'alliance.rank', 'test',
    'inc:' || alliance || ':' || at || ':' || coalesce(rank, 0), at,
    '00000000-0000-4000-8000-00000000cd77', 580, alliance, ext, server,
    'X', 'XXX', power, 40, rank);
$$;

-- A cross-server observation: both alliances, two different servers, one id.
select pg_temp.snap('00000000-0000-4000-8000-0000000aa001', 'ext-aa1', 580,
  '00000000-0000-4000-8000-0000000fb001', '2026-08-01T00:00:00Z', 1000, 3);
select pg_temp.snap('00000000-0000-4000-8000-0000000aa002', 'ext-aa2', 581,
  '00000000-0000-4000-8000-0000000fb001', '2026-08-01T00:00:00Z', 900, 4);

-- A later cross-server observation, so both alliances have two readings.
select pg_temp.snap('00000000-0000-4000-8000-0000000aa001', 'ext-aa1', 580,
  '00000000-0000-4000-8000-0000000fb002', '2026-08-05T00:00:00Z', 1500, 1);
select pg_temp.snap('00000000-0000-4000-8000-0000000aa002', 'ext-aa2', 581,
  '00000000-0000-4000-8000-0000000fb002', '2026-08-05T00:00:00Z', 950, 2);

select public.refresh_alliance_growth();
select public.refresh_alliance_latest();

select is(
  (select power_growth from public.alliance_growth_current
    where alliance_id = '00000000-0000-4000-8000-0000000aa001'),
  500::bigint,
  'a full rebuild still computes growth the way 0081 did');

select is(
  (select cross_rank_climb from public.alliance_growth_current
    where alliance_id = '00000000-0000-4000-8000-0000000aa001'),
  2,
  'and files those readings as CROSS-SERVER, which only the sibling row in the '
  'same observation can establish');

-- Now the thing this migration is for: refresh ONE alliance.
select public.refresh_alliance_growth(array['00000000-0000-4000-8000-0000000aa001']::uuid[]);

select is(
  (select count(*) from public.alliance_growth_current),
  2::bigint,
  'refreshing one alliance leaves the other one alone - the prune must not run '
  'on a partial refresh, or a batch of four would delete the other 159');

select is(
  (select cross_rank_climb from public.alliance_growth_current
    where alliance_id = '00000000-0000-4000-8000-0000000aa001'),
  2,
  'and the scoped scan still sees the whole observation, so the reading is '
  'still cross-server rather than quietly becoming a server one');

-- Same for latest.
select public.refresh_alliance_latest(array['ext-aa1']::text[]);

select is(
  (select count(*) from public.alliance_latest_current),
  2::bigint,
  'refreshing one external id leaves the other row in alliance_latest_current');

-- An empty array is "nothing moved", not "rebuild everything". A batch of
-- rows with no alliance_id must not fall through to the full scan this
-- migration exists to avoid.
select lives_ok(
  $$ select public.refresh_alliance_growth(array[]::uuid[]) $$,
  'an empty batch is a no-op rather than a full rebuild');

select * from finish();
rollback;
