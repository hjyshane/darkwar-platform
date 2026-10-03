-- Members read account state; they never write it, and never truncate it.
--
-- 0205 granted `select` to authenticated, and the local stack agrees. The
-- hosted project does not: its default privileges hand every new relation to
-- authenticated with ALL privileges, so prod showed `arwdDxtm` on both
-- account_state_snapshots and account_state_latest (checked 2026-10-02 with
-- `select relacl from pg_class`). Insert, update and delete are still stopped
-- by RLS — there is only a select policy — but TRUNCATE is not subject to
-- RLS at all. Revoke everything and grant back the one privilege meant.
--
-- The same drift is why prod_view_acl_drift and hosted_anon_function_grants
-- exist as notes: on this project, a grant written in a migration is a floor,
-- not the whole truth. Check relacl on prod after a push.

revoke all on public.account_state_snapshots from authenticated;
grant select on public.account_state_snapshots to authenticated;

revoke all on public.account_state_latest from authenticated;
grant select on public.account_state_latest to authenticated;
