-- 0006: RLS. Default is deny-all — enabling RLS with no policy blocks
-- everything, and policies below open only what §17.3 grants. The collector
-- and analyst write with the secret key, which bypasses RLS entirely
-- (NFR-001), so no write policies exist for anon/authenticated except the
-- officer refresh-request path.
--
-- Every policy change ships with a pgTAP negative test proving the
-- unauthorized read fails (§20.2 hard gate).

-- Role of the calling user. SECURITY DEFINER so it can read app_users from
-- inside policies without recursing through app_users' own RLS.
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role from public.app_users where user_id = auth.uid()),
    'viewer'::public.app_role
  )
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to anon, authenticated;

-- This Postgres image ships no default table grants for the API roles, so
-- privileges are explicit: coarse table-level grants here, row-level policy
-- below. New tables must be granted (and policied) deliberately.
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
-- The only client-side writes in this schema version.
grant insert, update on public.refresh_jobs to authenticated;
grant update on public.app_users to authenticated;

alter table public.servers enable row level security;
alter table public.alliances enable row level security;
alter table public.players enable row level security;
alter table public.player_names enable row level security;
alter table public.alliance_names enable row level security;
alter table public.app_users enable row level security;
alter table public.player_snapshots enable row level security;
alter table public.player_detail_snapshots enable row level security;
alter table public.alliance_snapshots enable row level security;
alter table public.alliance_member_snapshots enable row level security;
alter table public.arena_matches enable row level security;
alter table public.arena_snapshots enable row level security;
alter table public.arena_entries enable row level security;
alter table public.collectors enable row level security;
alter table public.collector_heartbeats enable row level security;
alter table public.refresh_jobs enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.schema_observations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.data_change_notifications enable row level security;
alter table public.metric_registry enable row level security;
alter table public.activity_facts enable row level security;
-- Not API-exposed, but RLS anyway: access is service_role only.
alter table internal.raw_observations enable row level security;

-- Public game rankings (§17.3: Viewer R). Readable without login — these
-- are numbers anyone can see in-game.
create policy public_read on public.servers
  for select to anon, authenticated using (true);
create policy public_read on public.players
  for select to anon, authenticated using (true);
create policy public_read on public.player_names
  for select to anon, authenticated using (true);
create policy public_read on public.alliances
  for select to anon, authenticated using (true);
create policy public_read on public.alliance_names
  for select to anon, authenticated using (true);
create policy public_read on public.player_snapshots
  for select to anon, authenticated using (true);
create policy public_read on public.player_detail_snapshots
  for select to anon, authenticated using (true);
create policy public_read on public.alliance_snapshots
  for select to anon, authenticated using (true);
create policy public_read on public.arena_matches
  for select to anon, authenticated using (true);
create policy public_read on public.arena_snapshots
  for select to anon, authenticated using (true);
create policy public_read on public.arena_entries
  for select to anon, authenticated using (true);
create policy public_read on public.metric_registry
  for select to anon, authenticated using (true);
-- The UI (including logged-out viewers) subscribes here for panel refetch.
create policy public_read on public.data_change_notifications
  for select to anon, authenticated using (true);

-- Alliance-internal presence (§17.3: Viewer -, Member limited R). Scoping
-- Members to their own alliance needs game_identity_links, which is
-- deferred — until then the line is drawn at role >= member.
create policy member_read on public.alliance_member_snapshots
  for select to authenticated
  using (public.current_app_role() in ('member', 'officer', 'admin'));

-- Activity facts feed the officer-facing risk/contribution views.
create policy officer_read on public.activity_facts
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));

-- Operational visibility.
create policy officer_read on public.collectors
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));
create policy officer_read on public.collector_heartbeats
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));
create policy officer_read on public.workflow_runs
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));
create policy officer_read on public.audit_logs
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));

-- Discovery inbox may contain unreviewed payload fragments: admin only.
create policy admin_read on public.schema_observations
  for select to authenticated
  using (public.current_app_role() = 'admin');

-- Refresh jobs (§17.3: Officer limited create, Admin RW; collector
-- consumes via service key). Rate limiting arrives with the Edge Function
-- command API; RLS draws the role line.
create policy officer_read on public.refresh_jobs
  for select to authenticated
  using (public.current_app_role() in ('officer', 'admin'));
create policy officer_create on public.refresh_jobs
  for insert to authenticated
  with check (
    public.current_app_role() in ('officer', 'admin')
    and requested_by = (select auth.uid())
  );
create policy admin_update on public.refresh_jobs
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- Users see their own row; admins see and manage everyone. Role changes go
-- through the admin policy (self-service profile editing comes later, so a
-- user cannot escalate their own role).
create policy self_read on public.app_users
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy admin_read on public.app_users
  for select to authenticated
  using (public.current_app_role() = 'admin');
create policy admin_write on public.app_users
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');
