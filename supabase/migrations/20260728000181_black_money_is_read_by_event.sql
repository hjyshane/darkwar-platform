-- 0181: Black Money, read one battle at a time.
--
-- 0178 stored three facts that arrive separately and carry no shared key:
-- who was put on each team (a signup reading), how each team did (the
-- battle history), and what each player scored (the battle report mail).
-- These two views place them against each other. What ties them is time,
-- and the rules are stated here once so no screen re-derives them:
--
--   A BATTLE is one row of the history per (alliance, team, end time) —
--   the newest reading of it, since a finished battle repeats unchanged in
--   every history response.
--
--   ITS SIGNUP LIST is the newest signup reading taken at or before the
--   battle ended, and no more than 7 days before. The list is a live
--   assignment officers edit up to the start; the last reading before the
--   end is the closest thing to "who was on the team". The 7-day bound keeps
--   a battle from borrowing the previous event's list when no reading was
--   taken in between — the event is fortnightly, so any reading older than
--   that belongs to another one. Battles before 2026-09-14, when readings
--   start, have no list and say so (signup_read_at is null).
--
--   ITS REPORT is our side's rows from a battle report sent within an hour
--   after the battle ended (12:54 for a 12:50 end in the captured data). A
--   report reaches only the players of the battle it describes, so it exists
--   only for the teams one of our accounts played on — report_seen says
--   whether one was captured, and without it "played" is unknown rather
--   than false.
--
-- One row per PERSON per battle in the member view (CLAUDE.md: a screen
-- counting people needs one row per person; PostgREST caps at 1,000). The
-- screen reads it one battle at a time, so a page is ~40-90 rows.
--
-- Both views are security_invoker: the three tables are member-only (0178)
-- and their policies gate once per statement (0179).

create index black_money_signup_server_captured_team_idx
  on public.black_money_signup_snapshots (server_id, captured_at desc, team_index);

create view public.black_money_battles
with (security_invoker = true) as
with latest as (
  select distinct on (b.alliance_external_id, b.battle_ended_at, b.team_index)
    b.server_id, b.alliance_id, b.alliance_external_id, b.battle_ended_at, b.team_index,
    b.state, b.score, b.user_num, b.max_user_num,
    b.enemy_name, b.enemy_abbr, b.enemy_score, b.enemy_user_num
  from public.black_money_battle_snapshots b
  order by b.alliance_external_id, b.battle_ended_at, b.team_index, b.captured_at desc
)
select
  l.*,
  r.signup_read_at,
  su.starters,
  su.substitutes,
  sc.players_scored,
  sc.players_scored > 0 as report_seen
from latest l
cross join lateral (
  select max(s.captured_at) as signup_read_at
    from public.black_money_signup_snapshots s
   where s.server_id = l.server_id
     and s.captured_at <= l.battle_ended_at
     and s.captured_at > l.battle_ended_at - interval '7 days'
) r
cross join lateral (
  select count(*) filter (where s.state = 1) as starters,
         count(*) filter (where s.state = 2) as substitutes
    from public.black_money_signup_snapshots s
   where s.server_id = l.server_id
     and s.captured_at = r.signup_read_at
     and s.team_index = l.team_index
) su
cross join lateral (
  select count(distinct p.game_uid) as players_scored
    from public.black_money_score_snapshots p
   where p.alliance_external_id = l.alliance_external_id
     and p.reported_at > l.battle_ended_at
     and p.reported_at <= l.battle_ended_at + interval '1 hour'
) sc;

comment on view public.black_money_battles is
  'One row per Black Money team battle: the result, the signup reading it is '
  'read against (null before readings began), starters and substitutes on '
  'that list, and whether a battle report was captured for it.';

create view public.black_money_battle_members
with (security_invoker = true) as
select
  b.alliance_external_id,
  b.battle_ended_at,
  b.team_index,
  m.game_uid,
  m.player_id,
  m.name,
  m.slot,
  m.played,
  m.score,
  m.kill_score,
  m.occupy_score,
  m.first_occupy_score,
  m.collect_score,
  m.escort_score
from public.black_money_battles b
cross join lateral (
  with signed as (
    select s.game_uid, s.player_id, s.name, s.state
      from public.black_money_signup_snapshots s
     where s.server_id = b.server_id
       and s.captured_at = b.signup_read_at
       and s.team_index = b.team_index
       and s.state in (1, 2)
  ),
  scored as (
    select distinct on (p.game_uid)
           p.game_uid, p.player_id, p.name, p.score, p.kill_score, p.occupy_score,
           p.first_occupy_score, p.collect_score, p.escort_score
      from public.black_money_score_snapshots p
     where p.alliance_external_id = b.alliance_external_id
       and p.reported_at > b.battle_ended_at
       and p.reported_at <= b.battle_ended_at + interval '1 hour'
     order by p.game_uid, p.captured_at desc
  )
  select
    coalesce(sc.game_uid, si.game_uid) as game_uid,
    coalesce(sc.player_id, si.player_id) as player_id,
    coalesce(sc.name, si.name) as name,
    case si.state when 1 then 'starter' when 2 then 'substitute' end as slot,
    -- Unknown, not false, when no report was captured for this battle.
    case when b.report_seen then sc.game_uid is not null end as played,
    sc.score, sc.kill_score, sc.occupy_score, sc.first_occupy_score,
    sc.collect_score, sc.escort_score
  from signed si
  full join scored sc on sc.game_uid = si.game_uid
) m;

comment on view public.black_money_battle_members is
  'One row per person per Black Money battle: their slot on the signup list '
  '(null if they played without being listed), whether they entered (null '
  'when no report was captured), and their score. Read one battle at a time.';

grant select on public.black_money_battles to authenticated;
grant select on public.black_money_battle_members to authenticated;
grant select on public.black_money_battles to service_role;
grant select on public.black_money_battle_members to service_role;
