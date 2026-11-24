-- 0211: six calendar categories; 'shop' is gone.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into public.event_names (activity_id, name, activity_type, category) values
  ('111001', 'Capital Clash', 54, 'major'),
  ('41101', 'Arctic Ice Pit', 126, 'season'),
  ('2010', 'Custom Weekly Pass', 288, 'pass');

select is(
  (select array_agg(category order by activity_id) from public.event_names
    where activity_id in ('111001', '41101', '2010')),
  array['major', 'pass', 'season'],
  'the new categories are accepted');
-- 'shop' itself is a well-formed key again since 0351 (any slug is); what
-- 0211 did was move the rows, and the dashboard still reads 'shop' as
-- 'premium' (knownCategory). The shape is what the table guards now.
select throws_ok(
  $$ update public.event_names set category = 'SHOP' where activity_id = '2010' $$,
  '23514', null, 'a category that is not a lowercase slug is refused');
select lives_ok(
  $$ update public.event_names set category = null where activity_id = '2010' $$,
  'unclassified is still allowed');

select * from finish();
rollback;
