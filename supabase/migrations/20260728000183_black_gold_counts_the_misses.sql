-- 0183: how often each member was put on a Black Gold team and did not play.
--
-- Two counts per person, asked for by the operator on 2026-09-27: times
-- listed as a STARTER who then did not enter, and times listed as a
-- SUBSTITUTE who did not. Counted from the 2026-09-27 event onward — the
-- first event with a signup reading AND both teams' reports captured, so
-- the first one where "did not play" is a fact rather than a gap.
--
-- ONLY BATTLES WITH A REPORT COUNT. `played` is null until the battle's
-- report is captured (0181, 0182); a battle without one says nothing about
-- anybody, and treating it as everybody missing would be the exact error
-- 0181 was written to avoid.
--
-- The start is a stated instant, not a rolling window. 02:00 UTC is
-- midnight on the game clock (UTC−2), so it is the start of the 27th as the
-- game shows it. Moving it is one migration; it is spelled once, here.
--
-- One row per person (CLAUDE.md: a screen counting people needs one row per
-- person). A row per miss would grow past PostgREST's 1,000-row cap within a
-- few events; folded here it stays at the size of the alliance.

create view public.black_money_member_misses
with (security_invoker = true) as
select
  m.alliance_external_id,
  m.game_uid,
  max(m.player_id::text)::uuid as player_id,
  count(*) filter (where m.slot = 'starter' and m.played = false) as starter_misses,
  count(*) filter (where m.slot = 'substitute' and m.played = false) as substitute_misses,
  count(*) filter (where m.slot = 'starter' and m.played is not null) as starter_battles,
  count(*) filter (where m.slot = 'substitute' and m.played is not null) as substitute_battles
from public.black_money_battle_members m
where m.battle_ended_at >= timestamptz '2026-09-27 02:00:00+00'
  and m.played is not null
group by m.alliance_external_id, m.game_uid;

comment on view public.black_money_member_misses is
  'Per member, since the 2026-09-27 event: times listed as starter or '
  'substitute and absent from the battle report, and how many reported '
  'battles each count is out of. Battles without a captured report are not '
  'counted either way.';

grant select on public.black_money_member_misses to authenticated;
grant select on public.black_money_member_misses to service_role;
