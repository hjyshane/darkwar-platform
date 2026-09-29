-- The members list and the activity screen, per alliance.
--
-- Two holes left after 0195/0200, both visible to an admin viewing ACE:
--
--   * The Members list showed every account in the install. The directory
--     let an admin past the alliance filter, because an admin may ACT on any
--     account; but a list is a view of the alliance on screen, and an admin
--     viewing ACE is looking for ACE's people. The filter now applies to
--     admins too; admin accounts themselves are listed everywhere. (The
--     app_users policy still lets an admin act on anybody.)
--   * "Activity this week" named the alliance's people but counted what they
--     did anywhere. activity_events gains the alliance the action happened
--     in — the alliance on screen when it was recorded — and a comment
--     counts in the alliance its post belongs to. Everything recorded so far
--     was CBFW's: ACE had nobody signed in yet.
--
-- event_scoreboard (0120) is untouched: it scores a finished August event.

alter table public.activity_events
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
  default public.active_alliance();

comment on column public.activity_events.alliance_id is
  'The alliance on screen when this happened. Null only where no alliance '
  'was pinned; read as the primary''s.';

update public.activity_events
   set alliance_id = public.primary_own_alliance()
 where alliance_id is null;

-- Once a day PER ALLIANCE: a member of both who opens a board in each has
-- done it in each.
alter table public.activity_events drop constraint activity_events_pkey;
alter table public.activity_events
  add constraint activity_events_once_a_day
  unique nulls not distinct (user_id, kind, activity_day, alliance_id);

-- A browser records into the alliance it is viewing, not into another.
create policy alliance_scope_insert on public.activity_events as restrictive
  for insert to authenticated
  with check (alliance_id is not distinct from (select public.active_alliance()));

-- What an account is in the alliance on screen: the directory's rule (0195),
-- as a function so the activity list can apply it. Definer: it reads
-- memberships the caller may not.
create function public.alliance_role_of(p_user uuid)
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.role = 'admin' then 'admin'::public.app_role
    when exists (select 1 from public.alliance_memberships x
                  join public.alliances oa on oa.alliance_id = x.alliance_id and oa.is_own
                 where x.user_id = u.user_id)
      then coalesce(
        (select m.role from public.alliance_memberships m
          where m.user_id = u.user_id and m.alliance_id = public.active_alliance()),
        'viewer'::public.app_role)
    else u.role
  end
  from public.app_users u
  where u.user_id = p_user
$$;

revoke all on function public.alliance_role_of(uuid) from public, anon;
grant execute on function public.alliance_role_of(uuid) to authenticated, service_role;

comment on function public.alliance_role_of(uuid) is
  'An account''s role in the alliance on screen: admin everywhere, its '
  'membership''s role there, viewer if it belongs elsewhere, app_users.role '
  'if it has no membership at all.';

create or replace view public.app_user_directory
with (security_invoker = false) as
select
  u.user_id,
  u.role,
  u.game_rank,
  u.display_name,
  u.player_id,
  u.created_at,
  a.email,
  a.email_confirmed_at,
  a.last_sign_in_at,
  case
    when u.role = 'admin' then 'admin'::public.app_role
    when exists (select 1 from public.alliance_memberships x
                  join public.alliances oa on oa.alliance_id = x.alliance_id and oa.is_own
                 where x.user_id = u.user_id)
      then coalesce(
        (select m.role from public.alliance_memberships m
          where m.user_id = u.user_id and m.alliance_id = public.active_alliance()),
        'viewer'::public.app_role)
    else u.role
  end as alliance_role,
  -- How many OTHER alliances the account is in. Non-zero means "remove"
  -- has to mean "from this alliance" (set_membership), not remove_member,
  -- which the guard refuses for exactly that account.
  (select count(*)::int from public.alliance_memberships x
    join public.alliances oa on oa.alliance_id = x.alliance_id and oa.is_own
    where x.user_id = u.user_id
      and x.alliance_id is distinct from public.active_alliance()) as other_alliances
from public.app_users u
join auth.users a on a.id = u.user_id
where public.has_permission('members.manage')
  -- Every account only where it belongs — for an admin viewing it as well.
  -- Admin accounts are listed in every alliance TO AN ADMIN (the role is
  -- global); an officer sees them only where they belong, as before (0195).
  and ((u.role = 'admin' and public.current_app_role() = 'admin')
       or public.account_in_view(u.user_id));

create or replace view public.activity_daily with (security_invoker = true) as
with sources as (
  select
    e.user_id,
    e.activity_day as day,
    (e.kind = 'login')::int as logins,
    (e.kind = 'rank_server')::int as server_opens,
    (e.kind = 'rank_alliance')::int as alliance_opens,
    (e.kind = 'rank_player')::int as player_opens,
    0 as comments
  from public.activity_events e
  where coalesce(e.alliance_id, (select public.primary_own_alliance()))
        is not distinct from (select public.active_alliance())

  union all

  select
    c.author_user_id as user_id,
    public.activity_day_of(c.created_at) as day,
    0, 0, 0, 0,
    1
  from public.post_comments c
  -- A comment counts in the alliance its post belongs to. Inner in effect:
  -- a post the reader cannot see (another alliance's, 0194) drops out.
  left join public.guides g on g.guide_id = c.guide_id
  left join public.announcements n on n.announcement_id = c.announcement_id
  where c.deleted_at is null
    and c.author_user_id is not null
    and (g.guide_id is not null or n.announcement_id is not null)
    and coalesce(g.alliance_id, n.alliance_id, (select public.primary_own_alliance()))
        is not distinct from (select public.active_alliance())
)
select
  user_id,
  day,
  sum(logins)::bigint as login_days,
  sum(server_opens)::bigint as server_days,
  sum(alliance_opens)::bigint as alliance_days,
  sum(player_opens)::bigint as player_days,
  sum(comments)::bigint as comment_count,
  public.activity_points(
    sum(logins)::bigint,
    sum(server_opens)::bigint,
    sum(alliance_opens)::bigint,
    sum(player_opens)::bigint,
    sum(comments)::bigint
  ) as points
from sources
group by user_id, day;

create or replace view public.activity_members with (security_invoker = true) as
select
  u.user_id,
  -- The character, else the account's display name, else null — the screen
  -- prints a dash rather than calling anybody unknown (0113).
  coalesce(p.current_name, u.display_name) as display_name
from public.app_users u
left join public.players p on p.player_id = u.player_id
-- A viewer can do none of the four things, so a row of zeroes against their
-- name is noise (0114 drew the same line).
-- The alliance on screen's members, by their role THERE: somebody who is an
-- officer of ACE and nothing in CBFW has app_users.role 'viewer'. Admin
-- accounts are listed everywhere to an admin, as in the directory.
where (u.role = 'admin' and public.current_app_role() = 'admin')
   or (public.account_in_view(u.user_id)
       and public.alliance_role_of(u.user_id) in ('member', 'officer'));
