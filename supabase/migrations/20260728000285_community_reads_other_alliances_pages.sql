-- 0285: the alliance and player pages, for the community role.
--
-- 0283 opened what the rankings read. Those rows link to an alliance page and a
-- player page, which read three more things:
--
--   alliance_growth_current, alliance_board_readings
--       the power chart and growth of ANY alliance: cross-server board data.
--       Invoker views over them, so only the policies need to name community.
--   player_component_power_history
--       a definer view with its own role gate (0104), so a policy cannot reach
--       it: it answered community nothing. Rewritten with the one gate widened
--       and the rest as it was, EXCEPT that a community reader gets no row for a
--       player whose last-known alliance is one of ours: the same line 0283
--       drew for rosters.
--
-- What stays closed, and the pages cope: alliance_roster_latest and
-- alliance_roster_history (the alliance page falls back to `players` by last
-- known alliance for every alliance but ours), player_contributions,
-- player_presence, player_subscriptions, rank tiers.

do $$
declare
  v_table text;
  v_policy record;
  v_new text;
  v_changed int;
begin
  foreach v_table in array array['alliance_growth_current', 'alliance_board_readings'] loop
    v_changed := 0;
    for v_policy in
      select policyname, qual
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and qual like '%app_role%'
    loop
      if v_policy.qual like '%''community''%' then
        v_changed := v_changed + 1;
        continue;
      end if;
      v_new := regexp_replace(
        v_policy.qual,
        '''member''::((public\.)?app_role)',
        '''member''::\1, ''community''::\1');
      if v_new = v_policy.qual then
        continue;
      end if;
      execute format('alter policy %I on public.%I using (%s)',
                     v_policy.policyname, v_table, v_new);
      v_changed := v_changed + 1;
    end loop;
    if v_changed = 0 then
      raise exception '0285: % has no SELECT policy to widen for community', v_table;
    end if;
  end loop;
end;
$$;

-- 0104's body, with the first gate widened for community.
create or replace view public.player_component_power_history as
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
  case
    when s.metric like 'hero%' then h.grade
    else null::smallint
  end as unit_grade,
  case
    when s.board_type is not null then (
      select count(*)
      from public.player_component_power_snapshots b
      join public.component_metrics bm on bm.metric = b.metric
      where b.observation_id = s.observation_id
        and (bm.visibility = 'member'
             or (select public.current_app_role() = 'admin')
             or public.is_service_request()))
    else null::bigint
  end as board_size
from public.player_component_power_snapshots s
join public.component_metrics m on m.metric = s.metric
left join public.heroes h on s.metric like 'hero%' and h.hero_id = s.unit_id
left join public.pets p on s.metric like 'pet%' and p.pet_id = s.unit_id
where (
        (select public.current_app_role() in ('member', 'officer', 'admin'))
        or (
          (select public.current_app_role() = 'community')
          and not exists (
            select 1
            from public.players pl
            join public.alliances al on al.alliance_id = pl.current_alliance_id
            where pl.player_id = s.player_id and al.is_own)
        )
        or public.is_service_request()
      )
  and (m.visibility = 'member'
       or (select public.current_app_role() = 'admin')
       or public.is_service_request());

-- 0185's lesson: say what the view is rather than trust what replace keeps.
alter view public.player_component_power_history set (security_invoker = false);
grant select on public.player_component_power_history to authenticated;
