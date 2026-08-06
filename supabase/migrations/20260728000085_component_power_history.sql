-- 0085: hero and pet power over time, with the unit named.
--
-- Four boards are captured per player and the dashboard only ever showed their
-- newest reading as a tile:
--
--   hero_power_total  board 45   every hero added up
--   hero_power_best   board 49   their strongest ONE, and which one (unit_id)
--   pet_power_total   board 79   every pet added up
--   pet_power_best    board 80   their strongest ONE, and which one
--
-- A tile answers "how strong now". It cannot answer "are they still building",
-- which for a hero roster is the more useful question — hero power moves in steps
-- when a shard threshold is crossed, and a step is invisible in a single figure.
--
-- WHAT THIS ADDS OVER THE TABLE, and why a view rather than a client query:
--
--   `board_size`, the denominator. 13th means one thing on a board of 150 and
--   another on a board of 20, and PostgREST cannot count over a partition — the
--   same reason 0081 and 0084 exist.
--
--   `unit_name` and `unit_grade`, resolved from the catalogue. `unit_id` is
--   populated for the two BEST boards (300 of 300 rows) and null for the totals,
--   which is right: a sum of every hero has no single hero to name. Every id
--   observed so far is in `heroes`, and every row of `heroes` carries a grade.
--
-- `security_invoker` so the reader's own RLS applies, as with the other history
-- views. The catalogues are member-readable and so is the snapshot table.
create view public.player_component_power_history
with (security_invoker = true) as
select
  s.player_id,
  s.server_id,
  s.captured_at,
  s.metric,
  s.power,
  s.rank,
  s.unit_id,
  -- The hero or pet this row is about, when it is about one. Two left joins rather
  -- than a case: `unit_id` lives in a different id space per family (heroes run
  -- 1002-40003, pets 101-107) and a single join would silently match the wrong
  -- catalogue if those ranges ever overlapped.
  case
    when s.metric like 'hero%' then h.name
    when s.metric like 'pet%' then p.name
  end as unit_name,
  -- Pets have no grade column yet, so this is the hero grade or nothing. Said
  -- plainly rather than defaulted to a number, which would be a grade nobody
  -- assigned.
  case when s.metric like 'hero%' then h.grade end as unit_grade,
  count(*) over (partition by s.observation_id) as board_size
from public.player_component_power_snapshots s
left join public.heroes h on s.metric like 'hero%' and h.hero_id = s.unit_id
left join public.pets p on s.metric like 'pet%' and p.pet_id = s.unit_id;

comment on view public.player_component_power_history is
  'Hero and pet power readings over time, with the board size behind each rank '
  'and the unit named from the catalogue. unit_id is set on the two "best" '
  'boards and null on the totals — a sum of every hero has no single hero to '
  'name. unit_grade is heroes only; pets carry no grade column.';
