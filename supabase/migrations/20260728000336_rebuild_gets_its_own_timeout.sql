-- 0336: Rebuild gets fifty seconds, not the eight every browser call gets.
--
-- WHAT HAPPENED. From 2026-11-18 14:49Z on, every Rebuild of a rank period
-- failed with "canceling statement due to statement timeout". CBFW's
-- 2026-11-02 -> 11-16 period could not be rebuilt under 0335 at all; its
-- newest rows stayed the 11-18 answer. Pressing again, which the screen's
-- message suggests (RankReportSetting.tsx, 2026-09-15), stopped working.
--
-- WHY. `build_rank_period` is one statement of index probes per member - about
-- 650 for 81 members in September, more since 0316 (up to four weekly
-- windows) and 0328 (a probe per duel day under `days`). The authenticated
-- role's statement_timeout is 8 s, and RankReportSetting already recorded the
-- build sitting at the edge of it on a database the collector writes to all
-- day. The database is now past its 8 GB allowance (0302) and the map sweep
-- writes far more than it did; the probes read from disk and the edge was
-- crossed for good. Nothing here has been measured with EXPLAIN on
-- production - that is still owed (docs/runbooks/db-performance.md rule 1).
--
-- THE FIX. A `set statement_timeout` in the definition of the function the
-- dashboard calls. Supabase applies a function's own statement_timeout to a
-- call made through the REST API from the client library, and allows client
-- calls up to 60 s ("Function level", supabase.com/docs/guides/database/
-- postgres/timeouts). Fifty leaves room under that cap. Rebuild is a rare,
-- deliberate press by an officer; waiting half a minute for it is fine, and a
-- failure after fifty seconds still writes nothing, as before.
--
-- ON THE WRAPPER, NOT ON `build_rank_period`. The timer is armed when the
-- statement the client sent begins, so only the function PostgREST calls can
-- move it; a setting on the scorer, which the wrapper calls, would be read too
-- late. And the scorer is re-created with every scoring version (0309, 0316,
-- 0328, 0329, 0335): CREATE OR REPLACE replaces a function's SET clauses with
-- the new definition's, so a timeout attached there with ALTER would vanish at
-- the next version. The wrapper has not changed since 0196, and the setting
-- is written into its definition so whoever copies it next copies this too.
-- pgTAP 336 fails if it is ever dropped.
--
-- Body unchanged from 0196. Same signature, so the grants stay.

create or replace function public.rebuild_rank_period(
  p_period_start timestamptz,
  p_apply_to_assigned boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
-- 0336: see the header. Keep this line when the function is re-created.
set statement_timeout = '50s'
as $$
declare
  written integer;
  current_version integer;
  v_alliance uuid := public.active_alliance();
begin
  -- Raises 42501 for a non-member, which is the check that guards both halves.
  written := public.build_rank_period(p_period_start);

  if p_apply_to_assigned and public.has_permission('members.manage') then
    -- The version the pass above wrote. Read back rather than passed in: the
    -- scoring version lives inside `build_rank_period` and bumping it there must
    -- not need a matching edit here.
    select max(scoring_version) into current_version
    from public.rank_period_snapshots
    where period_start = p_period_start
      and coalesce(alliance_id, public.primary_own_alliance()) is not distinct from v_alliance;

    -- Only this alliance's overrides, judged only by this alliance's rows.
    -- Under SECURITY DEFINER no RLS narrows these for us.
    delete from public.player_ranks as pr
    where pr.assigned_rank in ('R1', 'R2', 'R3')
      and coalesce(pr.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance
      and exists (
        select 1
        from public.rank_period_snapshots as l
        where l.player_id = pr.player_id
          and l.period_start = p_period_start
          -- Both halves matter. `tier is not null` keeps a member the period
          -- could not grade — clearing them would leave them with no rank at
          -- all. `scoring_version = current_version` keeps a member this pass
          -- SKIPPED, whose newest row is an older version's answer.
          and l.scoring_version = current_version
          and l.tier is not null
          and coalesce(l.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance
      );
  end if;

  return written;
end;
$$;

-- The REST API reads a function's settings from its schema cache. Supabase
-- reloads that cache on DDL by itself; saying so costs nothing when it already
-- has, and matters when this is pasted into the SQL Editor.
notify pgrst, 'reload schema';
