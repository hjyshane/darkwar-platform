-- 0070: keep our own people's history, let strangers' history age out.
--
-- Nothing is scheduled by this migration and nothing is deleted by applying
-- it. What it adds is a definition, a report, and a delete that refuses to run
-- unless it is asked twice. Deletion is the one operation this schema cannot
-- undo, and the counts should be looked at before it is ever pointed at real
-- rows: `select * from public.retention_report()`.
--
-- WHY, since it is not size. The whole database is about 47,000 rows against a
-- 500MB allowance. The argument is the growth rate: nine alliances swept
-- produced 13,875 member snapshots, and a daily sweep of all 162 would add
-- roughly 15,000 rows a day, indefinitely, almost all of it about people in
-- other alliances whose week-old power nobody will ever ask for.
--
-- WHAT IS NOT TOUCHED, and this is the important half:
--
--   * `players` and `alliances`. Small, and identity rather than history.
--     Deleting a player would cascade into `player_ranks` and
--     `player_contributions`, and an assigned rank is a human decision that no
--     capture can reconstruct. Retention must never be able to erase one.
--   * `player_names`. The record that a player renamed is the only way to find
--     them again; it does not grow with captures.
--   * Anything scored. `rank_periods` pins the rows a score was computed from,
--     and CLAUDE.md's rule is that historical scores are never overwritten.
--     Snapshot tables carry no foreign key from the scoring tables — verified
--     before writing this — so pruning them cannot orphan a score.
--
-- WHO COUNTS AS OURS: anyone who has EVER appeared in a member snapshot of an
-- alliance marked `is_own`. Not "is currently a member": a departure is
-- exactly the history worth keeping, and 0067 derives departures from these
-- same snapshots. Using current membership would delete the evidence that
-- somebody left within a week of them leaving.

create view public.own_player_ids
with (security_invoker = true) as
select distinct s.player_id
from public.alliance_member_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
where a.is_own and s.player_id is not null;

comment on view public.own_player_ids is
  'Players who have ever been in our alliance, including those who have left. '
  'The retention window turns on this: ours are kept for months, everyone '
  'else for days.';

grant select on public.own_player_ids to authenticated;

-- One function for both the report and the delete, so the two can never
-- disagree about what is in scope. `p_confirm` false counts; true deletes.
create function public.retention_report(
  p_confirm boolean default false,
  p_keep_ours interval default interval '3 months',
  p_keep_others interval default interval '7 days'
)
returns table (relation text, rows bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Each table's rule, written ONCE. The count and the delete run the same
  -- text, so a report cannot describe a different set of rows from the one
  -- that gets removed — which is the whole reason this is not two functions.
  --
  -- Dynamic SQL, reluctantly, and the reason it is safe here: every relation
  -- name and predicate below is a literal in this migration, none of it comes
  -- from a caller, and the only parameters are the two cutoffs, passed with
  -- USING rather than interpolated. `%I` quotes the identifier regardless.
  v_rules text[][] := array[
    ['player_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    ['player_component_power_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    ['player_detail_snapshots',
     'captured_at < case when player_id in (select player_id from public.own_player_ids)'
     || ' then $1 else $2 end'],
    -- Our own alliance's roster history is what 0067 derives departures from,
    -- so it keeps the long window whoever each row is about.
    ['alliance_member_snapshots',
     'captured_at < case when (select a.is_own from public.alliances a'
     || ' where a.alliance_id = alliance_member_snapshots.alliance_id)'
     || ' then $1 else $2 end'],
    -- One row per alliance per sweep rather than one per member: cheap to
    -- keep, and the only long series anyone has of another alliance's power.
    ['alliance_snapshots', 'captured_at < $1 and $2 is not null'],
    -- Whole boards, and only boards none of ours is on. arena_entries and
    -- arena_entry_heroes cascade from here, so the protection has to sit at
    -- this level: dropping a board would take our own member's lineup with it.
    ['arena_snapshots',
     'captured_at < $2 and $1 is not null and not exists ('
     || ' select 1 from public.arena_entries e'
     || ' where e.arena_snapshot_id = arena_snapshots.snapshot_id'
     || ' and e.player_id in (select player_id from public.own_player_ids))']
  ];
  v_ours timestamptz := now() - p_keep_ours;
  v_others timestamptz := now() - p_keep_others;
  v_relation text;
  v_predicate text;
  v_count bigint;
  i int;
begin
  if not public.has_permission('members.manage') then
    raise exception 'members.manage is required' using errcode = '42501';
  end if;

  for i in 1 .. array_length(v_rules, 1) loop
    v_relation := v_rules[i][1];
    v_predicate := v_rules[i][2];
    if p_confirm then
      execute format(
        'with removed as (delete from public.%I where %s returning 1) select count(*) from removed',
        v_relation, v_predicate
      ) into v_count using v_ours, v_others;
    else
      execute format('select count(*) from public.%I where %s', v_relation, v_predicate)
        into v_count using v_ours, v_others;
    end if;
    if v_count > 0 then
      relation := v_relation;
      rows := v_count;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.retention_report(boolean, interval, interval) from public;
grant execute on function public.retention_report(boolean, interval, interval) to authenticated;

comment on function public.retention_report(boolean, interval, interval) is
  'What retention would remove, per table. Counts by default and only '
  'deletes when p_confirm is true, from the same predicate it counted with. '
  'Requires members.manage. Touches snapshot tables only: players, alliances, '
  'player_names and everything scored are out of scope by design.';
