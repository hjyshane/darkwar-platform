-- 0101: the heartbeat history gets a pruner, because nothing else ever deletes it.
--
-- `collector_heartbeats` is append-only by design (0004): one row per beat, so an
-- operator can see WHEN a collector degraded, not merely that it is degraded now.
-- Everything that renders health reads the summary on `collectors` — the dashboard
-- card and the `sync_status` view both — so the history's only consumer is a person
-- diagnosing an incident, and the diagnostic value of a beat fades with age the way
-- the journal's raw payloads do (prune-journal, PR #164): past some window nobody
-- will ever ask "what was the outbox depth that afternoon".
--
-- 42,162 rows had accumulated by 2026-08-08 with no path to deletion. Not urgent —
-- the rows are small — but not urgent and unbounded are different things, which is
-- the same sentence the journal pruner was built on.
--
-- SAME CONTRACT AS retention_report (0070) AND prune-journal: counts by default,
-- deletes only when told. Nothing is scheduled; run it when the number warrants.
--
--   select * from prune_collector_heartbeats();                -- count only
--   select * from prune_collector_heartbeats(p_confirm := true);
--
-- 30 days default, matching the journal pruner's reasoning: the window is "how
-- long until somebody notices a question worth asking about a past incident".
-- Deleting history cannot break the dashboard — it never reads this table.
--
-- The table sits in the realtime publication, so a large confirmed prune emits a
-- delete event per row into WAL. No client subscribes to this table's changes
-- (checked: the dashboard subscribes to `collectors`), so the events go nowhere;
-- if a subscriber ever appears, prune off-hours.
--
-- Service-role only, and the revoke names all three of public, anon and
-- authenticated: `public` alone does not strip the hosted platform's direct
-- grants (0095), and role names alone do not strip the PUBLIC default (0096).
create function public.prune_collector_heartbeats(
  p_confirm boolean default false,
  p_keep interval default interval '30 days'
)
returns table (cutoff timestamptz, prunable bigint, deleted bigint)
language plpgsql
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - p_keep;
  v_prunable bigint;
  v_deleted bigint := 0;
begin
  select count(*) into v_prunable
  from public.collector_heartbeats h
  where h.reported_at < v_cutoff;

  if p_confirm then
    delete from public.collector_heartbeats h
    where h.reported_at < v_cutoff;
    get diagnostics v_deleted = row_count;
  end if;

  return query select v_cutoff, v_prunable, v_deleted;
end;
$$;

comment on function public.prune_collector_heartbeats(boolean, interval) is
  'Deletes heartbeat history older than p_keep (default 30 days). Counts only '
  'unless p_confirm — the 0070 contract. Nothing reads this history except a '
  'person diagnosing an incident; the dashboard and sync_status read the summary '
  'on collectors. Not scheduled, on purpose. Service-role only.';

revoke execute on function public.prune_collector_heartbeats(boolean, interval)
  from public, anon, authenticated;
