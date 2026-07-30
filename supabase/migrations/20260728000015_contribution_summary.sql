-- 0015: carry contribution scores into the players summary.
--
-- The dashboard's roster reads ONE table (players); that is what the 0008
-- summary triggers exist for. Contribution snapshots were landing with no
-- projection, so the scores were in the database but not on the screen.
--
-- Columns are per contribution_type because the two mean different things
-- and reset on different clocks: daily_donation resets every game day,
-- alliance_battle is the weekly duel. One "contribution" column would
-- average apples into oranges.
--
-- The per-type *_updated_at prefers the server's own score_updated_at over
-- captured_at: the server says when the score last changed; captured_at
-- only says when we happened to look.

alter table public.players add column daily_donation_score bigint;
alter table public.players add column daily_donation_updated_at timestamptz;
alter table public.players add column alliance_battle_score bigint;
alter table public.players add column alliance_battle_updated_at timestamptz;

create function public.apply_contribution_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Two passes, one per type, because each type gates on its OWN
  -- timestamp: a fresh daily donation must not be blocked by a newer
  -- alliance-battle reading, and vice versa. Newer-wins per 0008; a null
  -- score never erases a known one.
  update public.players p
  set daily_donation_score = coalesce(s.score, p.daily_donation_score),
      daily_donation_updated_at = s.effective_at,
      last_seen_at = greatest(coalesce(p.last_seen_at, s.captured_at), s.captured_at)
  from (
    select distinct on (player_id)
      player_id, score, captured_at,
      coalesce(score_updated_at, captured_at) as effective_at
    from new_rows
    where player_id is not null and contribution_type = 'daily_donation'
    order by player_id, coalesce(score_updated_at, captured_at) desc
  ) s
  where p.player_id = s.player_id
    and (p.daily_donation_updated_at is null or p.daily_donation_updated_at < s.effective_at);

  update public.players p
  set alliance_battle_score = coalesce(s.score, p.alliance_battle_score),
      alliance_battle_updated_at = s.effective_at,
      last_seen_at = greatest(coalesce(p.last_seen_at, s.captured_at), s.captured_at)
  from (
    select distinct on (player_id)
      player_id, score, captured_at,
      coalesce(score_updated_at, captured_at) as effective_at
    from new_rows
    where player_id is not null and contribution_type = 'alliance_battle'
    order by player_id, coalesce(score_updated_at, captured_at) desc
  ) s
  where p.player_id = s.player_id
    and (p.alliance_battle_updated_at is null or p.alliance_battle_updated_at < s.effective_at);

  return null;
end;
$$;

create trigger alliance_contribution_snapshots_summary
  after insert on public.alliance_contribution_snapshots
  referencing new table as new_rows
  for each statement execute function public.apply_contribution_summary();
