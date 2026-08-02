-- 0036: the duel's three boards stop sharing one metric_key, and every
-- contribution key says which period it means.
--
-- 0028 separated the three boards into their own contribution_type and their
-- own summary columns, and stopped there. Their facts kept landing on one
-- metric_key, which is the last place the three are still mixed:
--
--   metric_key             contribution_type        rows    max
--   alliance_battle_score  alliance_battle_daily     165    5,658,634
--   alliance_battle_score  alliance_battle_weekly    165   26,865,932
--   alliance_battle_score  alliance_battle_round      94  103,501,541
--
-- metric_registry gives that key `percentile_rank` over `reset_week`, so a
-- member's percentile depends on which of three populations — eighteen times
-- apart at the top — happened to be captured last. 0029 avoided exactly this
-- for donation by giving the weekly board its own key, and wrote down that
-- the duel still had it.
--
-- The old facts are corrected rather than left behind. They can be: every
-- fact carries source_snapshot_id, and that snapshot knows its
-- contribution_type, so which board each row belongs to is recoverable
-- rather than guessed. Checked before writing this — zero facts on the old
-- key fail to resolve. Nothing is being invented; value_numeric is
-- untouched and only the label it was filed under changes.
--
-- ## Donation is renamed in the same pass, deliberately
--
-- `alliance_donation_score` means the DAILY board and does not say so, which
-- is the naming that made this bug easy to write in the first place. Leaving
-- it beside `alliance_battle_daily_score` guarantees someone reads it as
-- "donation, all of it". Renaming costs three lines here and one in the
-- collector; not renaming costs the next person an afternoon.

insert into public.metric_registry (
  metric_key, display_name, domain, unit, entity_scope,
  aggregation, normalization_method, recommended_period, source_priority
) values
  ('alliance_battle_daily_score', 'Duel score (day)', 'alliance_contribution',
   'points', 'player', 'max', 'percentile_rank', 'reset_week',
   '["al.battle.rank.info"]'::jsonb),
  ('alliance_battle_weekly_score', 'Duel score (week)', 'alliance_contribution',
   'points', 'player', 'max', 'percentile_rank', 'reset_week',
   '["al.battle.rank.info"]'::jsonb),
  ('alliance_battle_round_score', 'Duel score (rounds)', 'alliance_contribution',
   'points', 'player', 'max', 'percentile_rank', 'reset_week',
   '["al.battle.rank.info"]'::jsonb),
  ('alliance_daily_donation_score', 'Alliance donation (day)', 'alliance_contribution',
   'points', 'player', 'max', 'percentile_rank', 'reset_week',
   '["get.daily.alliance.donate.rank"]'::jsonb);

-- Re-file each fact under the board its own snapshot names.
update public.activity_facts f
set metric_key = case s.contribution_type
      when 'alliance_battle_daily' then 'alliance_battle_daily_score'
      when 'alliance_battle_weekly' then 'alliance_battle_weekly_score'
      when 'alliance_battle_round' then 'alliance_battle_round_score'
    end
from public.alliance_contribution_snapshots s
where s.snapshot_id = f.source_snapshot_id
  and f.metric_key = 'alliance_battle_score'
  and s.contribution_type in (
    'alliance_battle_daily', 'alliance_battle_weekly', 'alliance_battle_round'
  );

update public.activity_facts
set metric_key = 'alliance_daily_donation_score'
where metric_key = 'alliance_donation_score';

-- Only drop the old keys once nothing points at them. A fact whose snapshot
-- has been deleted would be stranded here, and dropping the row it
-- references would take the fact with it or fail the constraint — either way
-- silently losing history. Left in place instead, which is visible.
delete from public.metric_registry
where metric_key in ('alliance_battle_score', 'alliance_donation_score')
  and not exists (
    select 1 from public.activity_facts f
    where f.metric_key = public.metric_registry.metric_key
  );

comment on table public.metric_registry is
  'One row per metric_key. A key names ONE population: three boards sharing '
  'a key put three scales into one percentile_rank, which is what 0036 '
  'undid for the duel and 0029 avoided for donation.';
