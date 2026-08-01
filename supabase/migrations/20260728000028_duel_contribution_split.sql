-- 0028: the duel's three rankings stop sharing one column.
--
-- al.battle.rank.info returns three boards under one command, labelled
-- against the game screen on 2026-08-01: type 0 daily, type 1 weekly, type 2
-- the total over the duel's four rounds. All three were stored as
-- contribution_type 'alliance_battle' with the number kept in `variant`.
--
-- That made the summary indefensible. 0020's trigger takes the most recent
-- alliance_battle row per player, and all three boards arrive in one capture
-- with the same captured_at, so which of the three reached the dashboard was
-- undefined — the column showed a daily figure, a weekly one or a four-round
-- total depending on insert order.

alter table public.alliance_contribution_snapshots
  drop constraint alliance_contribution_snapshots_contribution_type_check;

alter table public.alliance_contribution_snapshots
  add constraint alliance_contribution_snapshots_contribution_type_check
  check (contribution_type in (
    'daily_donation',
    'alliance_battle_daily',
    'alliance_battle_weekly',
    'alliance_battle_round'
  ));

-- Existing rows carry the board in `variant`, so they can be told apart
-- rather than discarded.
update public.alliance_contribution_snapshots
set contribution_type = case variant
      when 0 then 'alliance_battle_daily'
      when 1 then 'alliance_battle_weekly'
      when 2 then 'alliance_battle_round'
    end
where contribution_type = 'alliance_battle' and variant in (0, 1, 2);

-- A row that predates `variant` cannot be assigned to a board. There is no
-- honest place to put it, so it goes rather than being guessed into one.
delete from public.alliance_contribution_snapshots
where contribution_type = 'alliance_battle';

alter table public.player_contributions
  drop column alliance_battle_score,
  drop column alliance_battle_updated_at,
  add column duel_daily_score bigint,
  add column duel_daily_updated_at timestamptz,
  add column duel_weekly_score bigint,
  add column duel_weekly_updated_at timestamptz,
  add column duel_round_score bigint,
  add column duel_round_updated_at timestamptz;

comment on column public.player_contributions.duel_round_score is
  'Total over the duel''s four rounds (al.battle.rank.info type 2). Unlike '
  'daily and weekly, that board lists only our own alliance.';

-- Same newer-wins shape as 0020, once per contribution type. Each gates on
-- its own timestamp: a fresh daily reading must not be held back by a newer
-- weekly one, which is why these cannot collapse into a single pass.
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
