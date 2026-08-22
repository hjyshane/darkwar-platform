-- 0139: the member × building view shows one row per member per building
-- type, at the newest level, and shows a viewer nothing.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select has_column('public', 'member_season_buildings', c.col,
  'member_season_buildings has ' || c.col)
from unnest(array['player_id', 'building_type_id', 'level']) as c(col);

-- Newest per (member, building type), NOT newest overall: a pan sees part of
-- a member's plot, so one global captured_at would blank whatever that pan
-- happened to miss.
select is(
  (select count(*)::int
     from (select player_id, building_type_id
             from public.member_season_buildings
            group by 1, 2 having count(*) > 1) dupes),
  0,
  'one row per member per building type');

-- The view is security_invoker, so a viewer is stopped by the underlying
-- table's own policy rather than by anything written here.
set local role authenticated;
select is_empty(
  $$ select player_id from public.member_season_buildings $$,
  'a request with no member role reads no buildings');
reset role;

set local role anon;
select throws_ok($$ select player_id from public.member_season_buildings $$,
  '42501', null, 'anon reads no member buildings');
reset role;

select * from finish();
rollback;
