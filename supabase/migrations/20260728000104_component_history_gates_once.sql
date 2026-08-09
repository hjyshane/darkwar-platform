-- 0104: the component history asks who is asking once, not once per board row.
--
-- Third outbreak of the disease 0100 named. The player page's hero-and-pet
-- trend hit the statement timeout on production, and the mechanism is the same
-- uninlinable `current_app_role()` — this time multiplied by a correlated
-- subquery. `player_component_power_history` was security_invoker over an
-- 84,568-row table, so a member's read paid the role check three ways:
--
--   1. the RLS qual on every outer row the player filter returned;
--   2. the view's own WHERE, whose OR chain the planner is free to evaluate
--      role-first on every row;
--   3. and worst, inside `board_size`: a per-row correlated count over the
--      observation's ~100 board rows, each carrying the RLS qual AND the
--      visibility OR again. A player on 57 boards is ~5,700 role calls;
--      a well-collected player runs to tens of thousands, and at production's
--      per-call cost that is the whole statement timeout.
--
-- Reproduced at production scale locally (845 boards x 100 rows): 193 ms with
-- everything hot in RAM, against a table production reads cold.
--
-- Same medicine as 0102/0103: SECURITY DEFINER, so no RLS quals underneath,
-- with the role checks as InitPlan scalar subqueries — evaluated once per
-- query. The reader-facing answers do not move an inch:
--
--   | reader          | before (invoker+RLS)        | after (definer+gates)   |
--   |-----------------|-----------------------------|-------------------------|
--   | anon / viewer   | zero rows (RLS)             | zero rows (caller gate) |
--   | member/officer  | member-visibility metrics   | same (visibility gate)  |
--   | admin           | + admin metrics             | same                    |
--   | service request | everything                  | same                    |
--
-- 63_component_history_test pins that table, row by row, and 59's existing
-- assertions (no window, observation index) keep holding the 0099 fixes.
-- Local, same seed, same member session: 193 ms -> 5 ms.
create or replace view public.player_component_power_history
with (security_invoker = false) as
select
  s.player_id,
  s.server_id,
  s.captured_at,
  s.metric,
  m.label as metric_label,
  m.family,
  m.role,
  m.sort_order,
  s.power,
  s.rank,
  s.unit_id,
  s.source_command,
  case
    when s.metric like 'hero%' then h.name
    when s.metric like 'pet%' then p.name
  end as unit_name,
  case
    when s.metric like 'hero%' then h.grade
  end as unit_grade,
  -- How many rows the whole board held, a property of the observation rather
  -- than of the player filter (0099). Counted through the observation index
  -- with the visibility rule applied — and the role checks here are InitPlans,
  -- so this correlated count no longer re-asks who is asking for every board
  -- row it touches.
  case
    when s.board_type is not null then (
      select count(*)
      from public.player_component_power_snapshots b
      join public.component_metrics bm on bm.metric = b.metric
      where b.observation_id = s.observation_id
        and (bm.visibility = 'member'
             or (select public.current_app_role() = 'admin'::public.app_role)
             or public.is_service_request())
    )
  end as board_size
from public.player_component_power_snapshots s
join public.component_metrics m on m.metric = s.metric
left join public.heroes h on s.metric like 'hero%' and h.hero_id = s.unit_id
left join public.pets p on s.metric like 'pet%' and p.pet_id = s.unit_id
where
  -- Who may read at all: members and up, or the service. This was the RLS
  -- qual's job when the view was invoker; as definer it must be said here.
  ((select public.current_app_role() = any (array['member','officer','admin']::public.app_role[]))
   or public.is_service_request())
  -- And which metrics they may see: member-visibility for everyone the first
  -- gate admitted, the rest for admins and the service only.
  and (m.visibility = 'member'
       or (select public.current_app_role() = 'admin'::public.app_role)
       or public.is_service_request());

comment on view public.player_component_power_history is
  'Per-component power readings for one player with board context. SECURITY '
  'DEFINER with InitPlan role gates (0104): as an invoker view the RLS qual''s '
  'uninlinable current_app_role() ran per row AND per board row inside the '
  'correlated board_size count — tens of thousands of calls for one player, '
  'the statement timeout the player page reported. Caller gate (member+ or '
  'service) and metric visibility gate (member-visibility, or admin/service) '
  'reproduce exactly what RLS plus the old WHERE answered.';
