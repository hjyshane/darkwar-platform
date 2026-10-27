-- 0295: which roles see which sidebar tab, set by an admin from Settings.
--
-- HIDING ONLY. A row here takes an entry out of the sidebar and puts a notice in front
-- of the screen when its address is typed. It never grants anything: what a role may
-- read is still decided by the policies underneath, and a tab a role is not entitled to
-- stays hidden for it whatever this says. So the table can narrow a screen and never
-- widen one, and a wrong row costs a hidden tab, not a leak.
--
-- No row means the tab is shown as the code has always decided. An admin always sees
-- every tab, and the table refuses a row that says otherwise: the same lock-out
-- 0045 closed for members.manage.
--
-- The Migration tab starts hidden from everybody but admins.

create table public.tab_visibility (
  tab_key text not null check (tab_key ~ '^[A-Za-z0-9-]{1,40}$'),
  role public.app_role not null,
  visible boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (tab_key, role),
  constraint tab_visibility_admin_sees_all check (role <> 'admin' or visible)
);

alter table public.tab_visibility enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything (0207).
revoke all on public.tab_visibility from anon, authenticated;
grant select, insert, update, delete on public.tab_visibility to authenticated;
grant all on public.tab_visibility to service_role;

-- Everybody signed in reads it: the sidebar needs it to draw itself.
create policy member_read on public.tab_visibility
  for select to authenticated
  using (true);

-- Writing is an admin's alone, as a role - the way join_codes is.
create policy admin_insert on public.tab_visibility
  for insert to authenticated
  with check ((select public.current_app_role()) = 'admin');
create policy admin_update on public.tab_visibility
  for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');
create policy admin_delete on public.tab_visibility
  for delete to authenticated
  using ((select public.current_app_role()) = 'admin');

insert into public.tab_visibility (tab_key, role, visible) values
  ('migration', 'viewer', false),
  ('migration', 'community', false),
  ('migration', 'member', false),
  ('migration', 'officer', false);

comment on table public.tab_visibility is
  'Sidebar tabs an admin hides from a role (0295). Hiding only: no row means shown, an '
  'admin always sees every tab, and nothing here widens what a policy lets a role read.';
