-- 0304: pg_cron's own run log is trimmed for every job, not only the gift sender's.
--
-- `cron.job_run_details` takes a row per run. Two jobs run every minute (alerts-detect and
-- alerts-reconcile, 0130) and the rest hourly or daily, and only the gift sender's rows
-- were ever removed (0252), so the log had grown to 217 MB - the second-largest schema in
-- the database after `public` (measured 2026-11-02) - for a record nobody reads after a
-- day or two.
--
-- Three days is long enough to see a job that stopped running. The delete is one statement
-- a day, and the first run clears the backlog; the disk is only returned after
-- `vacuum full cron.job_run_details` (docs/runbooks/retention.md).

select cron.schedule(
  'cron-run-log-trim', '41 4 * * *',
  $job$ delete from cron.job_run_details where start_time < now() - interval '3 days' $job$);
