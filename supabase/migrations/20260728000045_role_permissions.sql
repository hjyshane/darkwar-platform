-- 0045: what a role may do becomes data, and the game rank becomes a label.
--
-- Two separate things that are easy to conflate, kept apart on purpose:
--
--   game_rank   R1-R5, the player's standing inside the alliance. Display
--               only. NOTHING in this schema reads it, and that is the
--               design — R4 in game does not mean "may edit the dashboard",
--               and wiring it to permissions would mean a promotion in a
--               game handed out write access to this app.
--   role        viewer / member / officer / admin, which is what policies
--               have always keyed on and still do.
--
-- What changes is that the ROLE no longer decides directly. Until now every
-- policy spelled out `current_app_role() = 'admin'` in its own text, so
-- "who may edit a notice" was a schema change, 31 of them across the
-- migrations. It is now a row.

alter table public.app_users
  add column game_rank text
    check (game_rank is null or game_rank in ('R1', 'R2', 'R3', 'R4', 'R5'));

comment on column public.app_users.game_rank is
  'The player''s rank inside the alliance, R1-R5. Shown, never enforced — no '
  'policy reads this column and none should.';

-- The registry exists so the admin screen can render a labelled grid, and so
-- a capability is a thing somebody named rather than a string typed twice.
-- A typo'd capability in a policy would read as "denied" and look exactly
-- like working correctly; 26_permissions_test asserts every capability a
-- policy names is in here.
create table public.capabilities (
  capability text primary key,
  label text not null,
  description text not null default '',
  sort_order int not null default 0
);

comment on table public.capabilities is
  'Every capability a policy checks. Nothing speculative: a capability with '
  'no policy behind it is a switch that does nothing, which is worse than '
  'not having the switch. Add rows in the migration that adds the policy.';

create table public.role_permissions (
  role public.app_role not null,
  capability text not null references public.capabilities (capability) on delete cascade,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, capability),

  -- An admin who unticks this box can never tick it again, and nobody else
  -- can either. The one door that does not get a lock on the inside.
  constraint role_permissions_admin_keeps_member_management
    check (not (role = 'admin' and capability = 'members.manage' and allowed = false))
);

comment on table public.role_permissions is
  'Role x capability. Seeded to reproduce exactly what the policies did '
  'before 0045, so this migration changes who may do what by zero.';

-- SECURITY DEFINER for the same reason current_app_role() is: it reads a
-- table from inside a policy and must not recurse through that table's own
-- RLS. The parameter is prefixed because `capability` is also the column.
create function public.has_permission(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select allowed
       from public.role_permissions
      where role = public.current_app_role()
        and capability = p_capability),
    false)
$$;

revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to anon, authenticated;

alter table public.capabilities enable row level security;
alter table public.role_permissions enable row level security;

-- Readable by everyone signed in: the dashboard greys out a control it knows
-- the database will refuse, and it cannot know without reading this. The
-- grid is not a secret — the refusal is enforced by the policies either way.
grant select on public.capabilities to anon, authenticated;
grant select on public.role_permissions to anon, authenticated;
grant insert, update, delete on public.role_permissions to authenticated;
grant all on public.capabilities to service_role;
grant all on public.role_permissions to service_role;

create policy public_read on public.capabilities
  for select to anon, authenticated using (true);

create policy public_read on public.role_permissions
  for select to anon, authenticated using (true);

create policy manage_write on public.role_permissions
  for all to authenticated
  using (public.has_permission('members.manage'))
  with check (public.has_permission('members.manage'));

create trigger role_permissions_notify
  after insert or update or delete on public.role_permissions
  for each statement execute function public.notify_topic_change('role_permissions');

insert into public.capabilities (capability, label, description, sort_order) values
  ('members.manage', 'Manage members',
   'Set a member''s role and alliance rank, and edit this permission grid.', 10),
  ('settings.write', 'Change dashboard settings',
   'The pinned alliance, which figures the overview shows, and the formulas.', 20),
  ('catalogue.write', 'Edit the hero and pet catalogues',
   'Names, classes and grades — the tables the game gives no names for.', 30),
  ('announcement.read', 'Read member notices',
   'Notices marked member-only. Public notices need no permission.', 40),
  ('announcement.write', 'Post a notice', '', 50),
  ('announcement.edit', 'Edit a notice', 'Any notice, not only your own.', 60),
  ('announcement.delete', 'Delete a notice', '', 70);

-- The seed IS the old behaviour, written out. Everything was admin-only
-- except reading member notices, which member and officer could already do.
insert into public.role_permissions (role, capability, allowed)
select r.role, c.capability,
       case
         when r.role = 'admin' then true
         when c.capability = 'announcement.read' and r.role in ('member', 'officer') then true
         else false
       end
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role)
cross join public.capabilities as c;

-- Policies stop naming roles.
--
-- Only the four tables whose writes an admin actually performs from the
-- dashboard move here. The read gates on snapshot tables still name roles
-- directly, and deliberately: those say "alliance business is not public",
-- which is a property of the data rather than a switch anyone should be
-- flipping from a settings page.

drop policy admin_write on public.app_settings;
create policy manage_write on public.app_settings
  for all to authenticated
  using (public.has_permission('settings.write'))
  with check (public.has_permission('settings.write'));

drop policy admin_write on public.heroes;
create policy manage_write on public.heroes
  for all to authenticated
  using (public.has_permission('catalogue.write'))
  with check (public.has_permission('catalogue.write'));

drop policy admin_write on public.pets;
create policy manage_write on public.pets
  for all to authenticated
  using (public.has_permission('catalogue.write'))
  with check (public.has_permission('catalogue.write'));

drop policy admin_write on public.app_users;
create policy manage_write on public.app_users
  for all to authenticated
  using (public.has_permission('members.manage'))
  with check (public.has_permission('members.manage'));

-- Announcements split four ways, which is the whole point of the exercise:
-- "may post" and "may delete someone else's" were one policy and are now
-- two switches. 0034's single admin_write becomes these.
drop policy admin_write on public.announcements;
drop policy member_read on public.announcements;

create policy member_read on public.announcements
  for select to authenticated
  using (public.has_permission('announcement.read'));

create policy write_insert on public.announcements
  for insert to authenticated
  with check (public.has_permission('announcement.write'));

create policy write_update on public.announcements
  for update to authenticated
  using (public.has_permission('announcement.edit'))
  with check (public.has_permission('announcement.edit'));

create policy write_delete on public.announcements
  for delete to authenticated
  using (public.has_permission('announcement.delete'));
