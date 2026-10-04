-- 0224: name a building by its last level BEFORE its industry tiers start.
--
-- 0222 took the highest untiered level's name, meaning to skip "Industrial
-- Watchtower". But the client carries a row past the last tier (Watchtower
-- 81, industry_level ''), so the highest untiered level was 81, and the
-- planner called Watchtower "Industrial Watchtower" on prod (2026-10-04).
-- Now: the highest level below the first tiered one; a subject without
-- tiers keeps its highest level's name, as before.

create or replace view public.game_upgrade_subjects
with (security_invoker = true) as
with first_tier as (
  select kind, subject_id, min(level) as level
  from public.game_upgrade_steps
  where tier is not null
  group by kind, subject_id
)
select
  s.kind,
  s.subject_id,
  max(s.level) as max_level,
  min(s.category) as category,
  (array_agg(s.name order by s.level desc)
    filter (where s.name is not null and (f.level is null or s.level < f.level)))[1] as name,
  (array_agg(s.name_ko order by s.level desc)
    filter (where s.name_ko is not null and (f.level is null or s.level < f.level)))[1] as name_ko
from public.game_upgrade_steps s
left join first_tier f on f.kind = s.kind and f.subject_id = s.subject_id
group by s.kind, s.subject_id;
