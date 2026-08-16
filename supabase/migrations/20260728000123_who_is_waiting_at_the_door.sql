-- 0123: people who signed in and got no further.
--
-- THE ROW DOES NOT EXIST, which is the whole reason this migration does.
--
-- `app_users` looks like the register of everybody who has an account, and it is
-- not. 0021 creates the row inside `redeem_join_code`, with the role the code
-- grants — `member` or `officer`, never `viewer`. So somebody who signs in with
-- Discord and has no code has no `app_users` row at all; `current_app_role()`
-- answers 'viewer' for them by FALLBACK (0006), not from a row anybody could
-- count. Searching `app_users` for `role = 'viewer'` finds nobody, always, and
-- the search looks like it worked.
--
-- Those people are invisible and stuck. They see nothing, nothing tells them why,
-- and nothing tells an admin they arrived. The only trace is in `auth.users`,
-- which PostgREST does not expose and a browser cannot read.
--
-- SO: a definer view, and a deliberately poorer one than 0069's directory.
-- `app_user_directory` carries the email because the members screen has to show
-- it. Nobody waiting at the door needs an email attached to be let in, so this
-- exposes none — an alert about a stranger should not be the thing that puts a
-- stranger's address in a Discord channel.
create view public.pending_access
with (security_invoker = false) as
select
  a.id as user_id,
  a.created_at,
  a.last_sign_in_at
from auth.users a
left join public.app_users u on u.user_id = a.id
where u.user_id is null
  -- The same pair every other definer view in this schema carries (0077, 0121):
  -- the capability for a person, `is_service_request()` for the notifier. Without
  -- the second disjunct this returns zero rows to `dw-notify` and "nobody is
  -- waiting" and "the collector cannot see" are the same empty list — which is
  -- exactly how 0077's four views failed, silently, for weeks.
  and (public.has_permission('members.manage') or public.is_service_request());

comment on view public.pending_access is
  'Signed-in accounts with no app_users row: they redeemed no join code, so '
  'they can see nothing and no table records them. DEFINER because auth.users '
  'is not client-readable; gated on members.manage or the service key. Carries '
  'no email, unlike app_user_directory - an alert about a stranger should not '
  'publish a stranger''s address.';

alter view public.pending_access set (security_barrier = on);

-- Named here rather than left to 0065's blanket revoke, for the reason 0076
-- gives: the intent should be local to the object, not inherited from a
-- migration dozens of numbers back.
revoke all on public.pending_access from anon;
grant select on public.pending_access to authenticated;
