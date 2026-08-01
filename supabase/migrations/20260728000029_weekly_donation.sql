-- 0029: the weekly donation ranking gets its own type and its own column.
--
-- Donation daily and weekly are two separate commands —
-- get.daily.alliance.donate.rank and get.week.alliance.donate.rank — not one
-- command with a period field, which is the shape the duel ranking has. Both
-- appear in re-capture.pcapng 37 seconds apart with an identical
-- {uid, score, updateTime} rankList, and their top three match the two lists
-- written off the game screen at capture time (daily 14500/11980/11980,
-- weekly 86440/80820/80640).
--
-- So the period is a fact the response carries in its command name. It is
-- never derived: a note in the handover once proposed subtracting yesterday's
-- daily snapshot to reconstruct a weekly total, which would have bound the
-- number's accuracy to how often the collector happened to look.

alter table public.alliance_contribution_snapshots
  drop constraint alliance_contribution_snapshots_contribution_type_check;

alter table public.alliance_contribution_snapshots
  add constraint alliance_contribution_snapshots_contribution_type_check
  check (contribution_type in (
    'daily_donation',
    'weekly_donation',
    'alliance_battle_daily',
    'alliance_battle_weekly',
    'alliance_battle_round'
  ));

alter table public.player_contributions
  add column weekly_donation_score bigint,
  add column weekly_donation_updated_at timestamptz;

comment on column public.player_contributions.weekly_donation_score is
  'Donation over the game week (get.week.alliance.donate.rank). A different '
  'board from daily_donation_score, not a running total of it: the two are '
  'separate commands and the weekly one is what the game itself reports.';

-- Unlike the duel, both donation boards list only our own alliance: the
-- weekly response carried 90 entries against al.rank's 94 members in the same
-- capture, with no name outside the roster. So no alliance filter is needed
-- here, and alliance_name stays null the way 0009 left it for daily.

-- 0028's shape, one more spec row. Each type still gates on its own
-- timestamp, so a fresh weekly reading is not held back by a newer daily one.
create or replace function public.apply_contribution_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec record;
begin
  for spec in
    select *
    from (values
      ('daily_donation', 'daily_donation_score', 'daily_donation_updated_at'),
      ('weekly_donation', 'weekly_donation_score', 'weekly_donation_updated_at'),
      ('alliance_battle_daily', 'duel_daily_score', 'duel_daily_updated_at'),
      ('alliance_battle_weekly', 'duel_weekly_score', 'duel_weekly_updated_at'),
      ('alliance_battle_round', 'duel_round_score', 'duel_round_updated_at')
    ) as t(ctype, score_col, stamp_col)
  loop
    execute format(
      'insert into public.player_contributions as c (player_id, %I, %I)
       select player_id, score, effective_at
       from (
         select distinct on (player_id)
           player_id, score, coalesce(score_updated_at, captured_at) as effective_at
         from new_rows
         where player_id is not null and contribution_type = %L
         order by player_id, coalesce(score_updated_at, captured_at) desc
       ) s
       on conflict (player_id) do update
       set %I = coalesce(excluded.%I, c.%I),
           %I = excluded.%I
       where c.%I is null or c.%I < excluded.%I',
      spec.score_col, spec.stamp_col, spec.ctype,
      spec.score_col, spec.score_col, spec.score_col,
      spec.stamp_col, spec.stamp_col,
      spec.stamp_col, spec.stamp_col, spec.stamp_col
    );
  end loop;

  -- last_seen_at still belongs to players: it records that we observed the
  -- player at all, which is not contribution and not restricted.
  update public.players p
  set last_seen_at = greatest(coalesce(p.last_seen_at, s.captured_at), s.captured_at)
  from (
    select player_id, max(captured_at) as captured_at
    from new_rows
    where player_id is not null
    group by player_id
  ) s
  where p.player_id = s.player_id
    and (p.last_seen_at is null or p.last_seen_at < s.captured_at);

  return null;
end;
$$;

-- Its own metric rather than a period on alliance_donation_score. The same
-- player reads ~14.5k daily and ~86k weekly; one metric_key would feed both
-- scales into one percentile_rank, and the ranking would then depend on which
-- board was captured most recently.
insert into public.metric_registry (
  metric_key, display_name, domain, unit, entity_scope,
  aggregation, normalization_method, recommended_period, source_priority
) values (
  'alliance_weekly_donation_score', 'Alliance donation (week)', 'alliance_contribution',
  'points', 'player', 'max', 'percentile_rank', 'reset_week',
  '["get.week.alliance.donate.rank"]'::jsonb
);
