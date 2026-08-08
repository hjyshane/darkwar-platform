-- 0097: `alliance_growth` bypassed RLS for anyone with an account.
--
-- 0073 created it thirty lines below `alliance_power_history`, which reads the
-- same table for the same audience:
--
--   line 33  create view public.alliance_power_history
--   line 34  with (security_invoker = true) as
--   ...
--   line 66  create view public.alliance_growth as        <- no `with` clause
--
-- Views default to security_invoker = false, so the missing clause made this
-- one run as its owner and see `alliance_snapshots` unfiltered. That table is
-- `member_read`. `grant select ... to authenticated` on line 131 then handed
-- the result to every signed-in account, including a `viewer` — somebody who
-- made an account and never redeemed a join code.
--
-- Measured before the fix, with a viewer session and two snapshot rows in
-- place: `alliance_snapshots` returned 0 and `alliance_growth` returned 1.
-- The RLS was working; the view was going round it.
--
-- 0081 reissued the view with `create or replace`, which preserves reloptions,
-- so it preserved the omission too.
--
-- An omission rather than a decision, and the file says so itself: the two
-- views under this one carry "DEFINER and gated, for 0067's reason exactly",
-- written to mark them out as the exceptions. This was never meant to be one.
alter view public.alliance_growth set (security_invoker = true);

comment on view public.alliance_growth is
  'Per alliance: power and rank at the first and last capture, the change '
  'between them, and the span it was measured over. Null growth means one '
  'reading — unmeasured, not flat. rank_climb is positive for climbing. '
  'security_invoker, like alliance_power_history beside it: alliance_snapshots '
  'is member-only and this must not be the way around that.';
