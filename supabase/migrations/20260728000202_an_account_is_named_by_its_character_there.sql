-- The activity screen names an account by its character IN THE ALLIANCE ON
-- SCREEN.
--
-- activity_members (0201) named everybody by app_users.player_id, the one
-- display character an account has. An account in both alliances — or an
-- admin, listed in both — showed its CBFW character on ACE's screen: the
-- admin read as "WonderingDuck" in ACE, where that character is not.
--
-- Now: the linked character (user_players, 0193) whose last known alliance is
-- the one on screen, the display character first when it qualifies; else the
-- account's own name. On the primary nothing changes for anybody whose
-- display character is there, which is everybody today.

create function public.account_name_in_view(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.current_name
       from public.user_players up
       join public.players p on p.player_id = up.player_id
      where up.user_id = p_user
        and p.current_alliance_id = public.active_alliance()
      order by (p.player_id = u.player_id) desc, p.current_name
      limit 1),
    u.display_name)
  from public.app_users u
  where u.user_id = p_user
$$;

revoke all on function public.account_name_in_view(uuid) from public, anon;
grant execute on function public.account_name_in_view(uuid) to authenticated, service_role;

comment on function public.account_name_in_view(uuid) is
  'An account''s name as the alliance on screen knows it: its character there '
  '(the display character first), else the account''s display name. Definer: '
  'it reads links the caller may not.';

create or replace view public.activity_members with (security_invoker = true) as
select
  u.user_id,
  -- The character in the alliance on screen, else the account's display
  -- name, else null — the screen prints a dash rather than calling anybody
  -- unknown (0113).
  public.account_name_in_view(u.user_id) as display_name
from public.app_users u
-- A viewer can do none of the four things, so a row of zeroes against their
-- name is noise (0114 drew the same line).
-- The alliance on screen's members, by their role THERE: somebody who is an
-- officer of ACE and nothing in CBFW has app_users.role 'viewer'. Admin
-- accounts are listed everywhere to an admin, as in the directory.
where (u.role = 'admin' and public.current_app_role() = 'admin')
   or (public.account_in_view(u.user_id)
       and public.alliance_role_of(u.user_id) in ('member', 'officer'));
