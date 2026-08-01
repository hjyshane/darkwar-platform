-- 0027: a duel ranking names both alliances, and we were not recording which.
--
-- al.battle.rank.info's daily and weekly rankings list BOTH sides of the
-- duel. Measured against a capture where al.rank reports 94 members: types 0
-- and 1 carry 165 rows — 93 of ours and 72 from the opposing alliance —
-- while type 2, the round total, carries only our 94.
--
-- The parser wrote alliance_id as null, so nothing on the row said whose
-- score it was. Every row looked equally like ours, and a reader summing the
-- table would have been adding an opponent's duel points to our alliance's.
--
-- Recorded as a name because that is what the payload gives. There is no
-- alliance id in this response, the same shape alliance.rank and the arena
-- have, and resolving a name to public.alliances would be a guess: names are
-- not unique across servers and players rename alliances.

alter table public.alliance_contribution_snapshots
  add column alliance_name text,
  add column alliance_code text;

comment on column public.alliance_contribution_snapshots.alliance_name is
  'The alliance this player was scoring for, as the response reported it. '
  'Text, not a reference: al.battle.rank.info carries no alliance id. A duel '
  'ranking names both sides, so this is what separates them.';

comment on column public.alliance_contribution_snapshots.alliance_code is
  'The alliance tag from the same response, when it carried one.';

-- Filtering "our alliance's duel scores" is now a predicate on this column,
-- and it leads because a duel ranking is read whole.
create index alliance_contribution_snapshots_alliance_name_idx
  on public.alliance_contribution_snapshots (alliance_name, captured_at desc)
  where alliance_name is not null;
