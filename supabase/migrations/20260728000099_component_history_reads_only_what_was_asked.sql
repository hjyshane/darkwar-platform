-- 0099: the component history view sorted 56,000 rows to return 560.
--
-- The last of the timeouts. Confirmed from the Postgres log as 57014
-- `canceling statement due to statement timeout`, and reproduced under an
-- authenticated member session at production scale (70,000 rows against
-- production's 70,482):
--
--   Filter: (player_id = '...')
--   Rows Removed by Filter: 55440          <- the filter lands ABOVE
--     -> WindowAgg (actual rows=56000)
--         -> Sort (actual rows=56000)
--               Sort Key: s.observation_id
--               Sort Method: external merge  Disk: 7360kB
--   Buffers: shared hit=58818, temp read=920 written=922
--
-- `count(*) OVER (PARTITION BY observation_id)` partitions by something the
-- caller did not filter on, so the player_id qual cannot be pushed under it
-- without changing the answer — Postgres is right to refuse. The cost is a
-- sort of the whole table that spills to disk, and on a shared instance with
-- slower storage that is what runs out the clock.
--
-- The same shape and the same cure as `player_power_history` in 0098, which
-- went 44.5 ms -> 0.12 ms. This view was missed there because it is a
-- different view with a similar name.
--
-- WHAT THE COUNT ACTUALLY COUNTS, and the reason this is not a copy-paste of
-- 0098. The window runs AFTER the join to `component_metrics` and after the
-- visibility predicate, so `board_size` is "rows from this observation that
-- survived those" — not "rows in the table with this observation_id". A naive
-- scalar subquery over the snapshot table alone would count metrics the view
-- itself excludes and quietly report a bigger board. The subquery below
-- repeats the join and the predicate so the number does not move.
--
-- The two LEFT JOINs are left out of it on purpose: `heroes.hero_id` and
-- `pets.pet_id` are primary keys, so they match at most one row each and
-- cannot change the count.
create or replace view public.player_component_power_history
with (security_invoker = true) as
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
    else null::text
  end as unit_name,
  case when s.metric like 'hero%' then h.grade else null::smallint end as unit_grade,
  case
    when s.board_type is not null then (
      select count(*)
        from public.player_component_power_snapshots b
        join public.component_metrics bm on bm.metric = b.metric
       where b.observation_id = s.observation_id
         and (bm.visibility = 'member'
              or public.current_app_role() = 'admin'
              or public.is_service_request())
    )
    else null::bigint
  end as board_size
from public.player_component_power_snapshots s
join public.component_metrics m on m.metric = s.metric
left join public.heroes h on s.metric like 'hero%' and h.hero_id = s.unit_id
left join public.pets p on s.metric like 'pet%' and p.pet_id = s.unit_id
where m.visibility = 'member'
   or public.current_app_role() = 'admin'
   or public.is_service_request();

comment on view public.player_component_power_history is
  'Per-metric power history with the size of the board each reading came from. '
  'board_size is a scalar subquery rather than a window so that filtering by '
  'player reaches the scan — see 0099, and 0098 for the same fix next door.';

-- What makes that subquery a lookup instead of a scan. 0098 added the twin of
-- this index to player_snapshots for the same reason.
create index if not exists player_component_power_snapshots_observation_idx
  on public.player_component_power_snapshots (observation_id);
