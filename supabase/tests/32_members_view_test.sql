-- 0063: members.view, the registry's first READ capability.
--
-- The negative §20.2 asks for is here, but so is the honest limit of what
-- this capability does. It decides whether a screen is OFFERED. It does not
-- make the roster secret, and a test implying otherwise would be worse than
-- no test — 0049 shipped a comment claiming a protection that did not exist
-- and it took a session to notice.
--
-- What has to hold:
--   1. a viewer is refused, a member is not
--   2. a ROLE decides it, never app_users.game_rank
--   3. the figures that ARE alliance-internal stay member-only whatever
--      this row says — flipping members.view must not move them
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-viewer@test.invalid'),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'mv-member@test.invalid');

-- The viewer is given the TOP game rank and the member none, so that any
-- test below which passes because of the rank rather than the role fails
-- loudly instead of looking correct.
insert into public.app_users (user_id, role, display_name, game_rank) values
  ('00000000-0000-4000-8000-00000000d001', 'viewer', 'mv viewer', 'R5'),
  ('00000000-0000-4000-8000-00000000d002', 'member', 'mv member', null);

create function pg_temp.act_as(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who)::text, true);
$$;

select has_column('public', 'capabilities', 'capability', 'the registry exists');
select is(
  (select count(*) from public.capabilities where capability = 'members.view'),
  1::bigint, 'members.view is a registered capability, not a string in the app');

-- 1. The gate.
set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000d001');
select is(public.has_permission('members.view'), false,
  'a viewer is not offered the Members screen');
reset role;

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000d002');
select is(public.has_permission('members.view'), true,
  'a member is');
reset role;

-- 2. The rank is not the gate. The viewer above holds R5 and is still
-- refused; this states it as its own assertion so the reason is on record.
select is(
  (select game_rank from public.app_users
    where user_id = '00000000-0000-4000-8000-00000000d001'),
  'R5', 'the refused reader holds the highest game rank');
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%game_rank%' $$,
  'and still no policy reads game_rank — 0045''s rule survives this change');

-- 3. Granting the screen must not grant the figures on it. They are
-- protected by their own tables (0020, 0024, 0059), not by the tab.
update public.role_permissions set allowed = true
where role = 'viewer' and capability = 'members.view';

set local role authenticated;
select pg_temp.act_as('00000000-0000-4000-8000-00000000d001');
select is(public.has_permission('members.view'), true,
  'the viewer may now be shown the screen');
select is_empty($$ select * from public.player_contributions $$,
  'and still cannot read contribution — the tab is not the boundary');
select is_empty($$ select * from public.player_presence $$,
  'nor presence');
reset role;

select * from finish();
rollback;
