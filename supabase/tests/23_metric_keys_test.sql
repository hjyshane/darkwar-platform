-- 0036: a metric_key names one population.
--
-- The duel's three boards shared alliance_battle_score while
-- metric_registry gave that key percentile_rank — so a member's percentile
-- depended on which of three populations, eighteen times apart at the top,
-- was captured last. This file pins that they are separate and that the
-- historical facts were re-filed rather than left mixed.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select has_column('public', 'metric_registry', 'metric_key', 'metric_registry exists');

-- The three duel boards, and both donation periods, each have their own key.
select is(
  (select count(*) from public.metric_registry
   where metric_key in ('alliance_battle_daily_score', 'alliance_battle_weekly_score',
                        'alliance_battle_round_score')), 3::bigint,
  'the duel has one metric per board, not one for all three');
select is(
  (select count(*) from public.metric_registry
   where metric_key in ('alliance_daily_donation_score', 'alliance_weekly_donation_score')),
  2::bigint,
  'and donation has one per period');

-- The ambiguous predecessors are gone, so nothing new can be filed under
-- them by accident.
select is((select count(*) from public.metric_registry
           where metric_key in ('alliance_battle_score', 'alliance_donation_score')),
          0::bigint,
  'the keys that meant several things at once are retired');

-- Every contribution fact agrees with the snapshot it came from. This is the
-- assertion the old shape could not make: with one key for three boards, a
-- board filed under another's name was indistinguishable from a correct one.
select is(
  (select count(*)
   from public.activity_facts f
   join public.alliance_contribution_snapshots s on s.snapshot_id = f.source_snapshot_id
   where f.metric_key <> case s.contribution_type
       when 'daily_donation' then 'alliance_daily_donation_score'
       when 'weekly_donation' then 'alliance_weekly_donation_score'
       when 'alliance_battle_daily' then 'alliance_battle_daily_score'
       when 'alliance_battle_weekly' then 'alliance_battle_weekly_score'
       when 'alliance_battle_round' then 'alliance_battle_round_score'
     end),
  0::bigint,
  'every contribution fact is filed under the board its snapshot names');

-- A key with no registry row would be an orphan the FK is supposed to stop;
-- assert it directly, because the re-filing above wrote metric_key by hand.
select is(
  (select count(*) from public.activity_facts f
   where not exists (select 1 from public.metric_registry m
                     where m.metric_key = f.metric_key)),
  0::bigint,
  'no fact points at a metric that does not exist');

-- percentile_rank over a key is only meaningful if the key is one scale.
select is(
  (select count(distinct normalization_method) from public.metric_registry
   where metric_key like 'alliance_battle%'), 1::bigint,
  'the three duel keys are normalised the same way, so they stay comparable to themselves');

select * from finish();
rollback;
