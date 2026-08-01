-- 0023: al.battle.rank.info returns two different rankings under the same
-- command, distinguished only by a `type` field (0 and 1 were both captured,
-- with different leaders and score magnitudes an order apart).
--
-- Written as 0010 and never merged, so the 0010 slot stayed vacant while
-- 0011-0022 shipped. Renumbered to the end on merge: a migration that sorts
-- before ones already applied is skipped by any database that is not rebuilt
-- from scratch.
--
-- What `type` means is not known, so it is recorded rather than interpreted:
-- naming the column `variant` and leaving it uninterpreted is honest, whereas
-- inventing contribution_type values like 'alliance_battle_weekly' would be a
-- guess baked into the schema.

alter table public.alliance_contribution_snapshots
  add column variant int;

comment on column public.alliance_contribution_snapshots.variant is
  'Server-side ranking discriminator (al.battle.rank.info `type`). Meaning unconfirmed; two variants observed.';

insert into public.metric_registry (
  metric_key, display_name, domain, unit, entity_scope,
  aggregation, normalization_method, recommended_period, source_priority
) values (
  'alliance_battle_score', 'Alliance battle score', 'alliance_contribution',
  'points', 'player', 'max', 'percentile_rank', 'reset_week',
  '["al.battle.rank.info"]'::jsonb
);
