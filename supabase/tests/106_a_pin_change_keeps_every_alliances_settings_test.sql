-- 0197: adding an alliance, or changing which one is primary, never changes
-- the settings any alliance is using — and a promoted alliance's edits take.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.alliances (alliance_id, server_id, external_id, current_name, current_code)
values
  ('00000000-0000-4000-8000-0000000a6001', 580, 'ext-pc-a', 'Alpha', 'AAA'),
  ('00000000-0000-4000-8000-0000000a6002', 581, 'ext-pc-b', 'Bravo', 'BBB');

-- Alpha alone, with tiers of its own in the shared row.
delete from public.app_settings where key in ('own_alliance', 'rank_tiers');
insert into public.app_settings (key, value)
values ('own_alliance', '{"alliance_ids": ["00000000-0000-4000-8000-0000000a6001"]}');
insert into public.app_settings (key, value) values ('rank_tiers', '{"who": "alpha v1"}');

-- 1. Alone, the primary has no override: it IS the shared row.
select is(
  (select count(*)::int from public.alliance_settings
    where alliance_id = '00000000-0000-4000-8000-0000000a6001'),
  0, 'the primary keeps its settings in app_settings');

-- 2-3. Pin Bravo as well: it starts from a frozen copy of Alpha's tiers...
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000a6001",
                               "00000000-0000-4000-8000-0000000a6002"]}'
where key = 'own_alliance';
select is(
  public.alliance_setting('rank_tiers', '00000000-0000-4000-8000-0000000a6002') ->> 'who',
  'alpha v1', 'a newly pinned alliance starts from the primary''s tiers');

-- ...which Alpha's next edit does not move.
update public.app_settings set value = '{"who": "alpha v2"}' where key = 'rank_tiers';
select is(
  public.alliance_setting('rank_tiers', '00000000-0000-4000-8000-0000000a6002') ->> 'who',
  'alpha v1', 'and the primary''s later edits do not move it');

-- Bravo's officers make it their own.
update public.alliance_settings set value = '{"who": "bravo v1"}'
where alliance_id = '00000000-0000-4000-8000-0000000a6002' and key = 'rank_tiers';

-- 4-7. Swap the primary.
update public.app_settings
set value = '{"alliance_ids": ["00000000-0000-4000-8000-0000000a6002",
                               "00000000-0000-4000-8000-0000000a6001"]}'
where key = 'own_alliance';

select is(
  public.alliance_setting('rank_tiers', '00000000-0000-4000-8000-0000000a6001') ->> 'who',
  'alpha v2', 'the old primary keeps exactly the tiers it had');
select is(
  public.alliance_setting('rank_tiers', '00000000-0000-4000-8000-0000000a6002') ->> 'who',
  'bravo v1', 'and so does the new one');
select is((select value ->> 'who' from public.app_settings where key = 'rank_tiers'),
  'bravo v1', 'the new primary''s tiers moved into the shared row');
select is(
  (select count(*)::int from public.alliance_settings
    where alliance_id = '00000000-0000-4000-8000-0000000a6002'),
  0, 'and its override went, so it cannot shadow its own edits');

-- 8. Which is what makes an edit by the new primary actually take.
update public.app_settings set value = '{"who": "bravo v2"}' where key = 'rank_tiers';
select is(
  public.alliance_setting('rank_tiers', '00000000-0000-4000-8000-0000000a6002') ->> 'who',
  'bravo v2', 'an edit by the promoted primary takes effect');

select * from finish();
rollback;
