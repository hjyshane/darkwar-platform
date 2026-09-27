-- 0182: the other side of a Black Gold battle, and a correction.
--
-- THE CORRECTION. 0178's parser and 0181's views said the battle report
-- "reaches only the players of the battle it describes". It does not. The
-- report is alliance mail: every member gets both teams' reports, whether
-- they played or not. The operator said so on 2026-09-27, and the capture
-- agrees — the collector account received team A's report that evening.
--
-- What really limits coverage is the INBOX, not delivery. The game fetches
-- the list newest first, twenty mails at a time, and most of the list is
-- other traffic (type 72 alone fills whole pages), so a page reaches back
-- only a few hours. A report older than that is still in the mailbox — for
-- the 30 days mail lives — but reaches the collector only if somebody
-- scrolls down to it. `report_seen = false` therefore means "not captured
-- yet", which the comments below now say.
--
-- THE OTHER SIDE. The report lists both alliances' players, and 0178 keeps
-- both. `black_money_battle_members` is ours; this view is theirs, read the
-- same way — the report rows sent within an hour after the battle ended
-- whose alliance is not ours. One row per person, ~20 per battle.

create view public.black_money_battle_opponents
with (security_invoker = true) as
select
  b.alliance_external_id,
  b.battle_ended_at,
  b.team_index,
  p.game_uid,
  p.player_id,
  p.name,
  p.server_id,
  p.alliance_external_id as opponent_alliance_external_id,
  p.alliance_abbr as opponent_abbr,
  p.score,
  p.kill_score,
  p.occupy_score,
  p.first_occupy_score,
  p.collect_score,
  p.escort_score
from public.black_money_battles b
cross join lateral (
  select distinct on (s.game_uid)
         s.game_uid, s.player_id, s.name, s.server_id, s.alliance_external_id,
         s.alliance_abbr, s.score, s.kill_score, s.occupy_score,
         s.first_occupy_score, s.collect_score, s.escort_score
    from public.black_money_score_snapshots s
   where s.alliance_external_id <> b.alliance_external_id
     and s.reported_at > b.battle_ended_at
     and s.reported_at <= b.battle_ended_at + interval '1 hour'
   order by s.game_uid, s.captured_at desc
) p;

comment on view public.black_money_battle_opponents is
  'One row per opposing player per Black Gold battle, from the same battle '
  'report our side is read from. Read one battle at a time.';

grant select on public.black_money_battle_opponents to authenticated;
grant select on public.black_money_battle_opponents to service_role;

comment on view public.black_money_battles is
  'One row per Black Gold team battle: the result, the signup reading it is '
  'read against (null before readings began), starters and substitutes on '
  'that list, and whether its battle report has been captured. The report is '
  'alliance mail every member receives; report_seen = false means nobody has '
  'loaded it into the collector yet (it may be further down the inbox), not '
  'that it was never sent.';

comment on view public.black_money_battle_members is
  'One row per person per Black Gold battle: their slot on the signup list '
  '(null if they played without being listed), whether they entered (null '
  'while the report is not yet captured), and their score. Read one battle at '
  'a time.';
