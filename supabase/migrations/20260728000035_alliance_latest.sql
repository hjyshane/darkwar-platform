-- 0035: the alliance ranking asks for the current state instead of guessing
-- it from a slice of history.
--
-- RankingsPanel fetched `alliance_snapshots order by captured_at desc limit
-- 200` and kept the newest row per alliance in the browser. That works while
-- the table is small and quietly stops working as captures accumulate: the
-- 200 rows are the 200 most recent SNAPSHOTS, not the 200 most recent
-- alliances, so an alliance whose only sighting has aged out of the window
-- disappears from the ranking.
--
-- Measured on this database: at 142 snapshots all 129 alliances showed; at
-- 250 snapshots — three sweeps, which is a week of ordinary use — only 122
-- did. Seven alliances silently gone, and the list shrinks the more the
-- collector is run. A limit tuned to today's row count is not a fix; the
-- query was asking the wrong question.
--
-- `distinct on` is the answer Postgres already has for "the newest row per
-- group", and it belongs in the database rather than in a component: the
-- server-drilldown page runs the same dedupe over the same table, and a rule
-- in two places is a rule that will disagree with itself.

create view public.alliance_latest
with (security_invoker = true) as
select distinct on (external_id)
  snapshot_id,
  alliance_id,
  external_id,
  server_id,
  rank,
  name,
  code,
  power,
  member_count,
  captured_at
from public.alliance_snapshots
order by external_id, captured_at desc;

comment on view public.alliance_latest is
  'The newest snapshot of each alliance. security_invoker so the caller''s '
  'RLS applies rather than the view owner''s — a view is otherwise a way to '
  'read past a policy, which is exactly what this project spent 0016 and '
  '0020 closing.';

grant select on public.alliance_latest to anon, authenticated;
