-- 0080: an author with no character still has a name.
--
-- 0079 resolved an author as `coalesce(players.current_name, 'Unknown member')`,
-- which is right whenever the account is linked to a character and useless when
-- it is not. The first real post on the cloud hit exactly that: the admin account
-- had written both the guide and the notice, its `player_id` was null, and both
-- boards credited "Unknown member" — for the one person the alliance could name
-- without being told.
--
-- Linking the account is the better fix and was done. This is the fix for the
-- case that recurs: an officer gets `guide.write` before anybody gets round to
-- linking them, writes something useful, and is credited to nobody.
--
-- `app_users.display_name` is what an admin already types when admitting
-- somebody, so it needs no new column and no new screen.
--
-- STILL AUTHORS ONLY. The narrowing is the whole justification for this view
-- existing — you may see who wrote the thing you are reading, and nothing
-- further — and adding a second name source does not widen who it covers.
create or replace view public.post_authors as
select
  u.user_id,
  -- The character first. The alliance knows each other by who they are in the
  -- game, so a linked account should read the same on the board as it does on
  -- the roster, even when display_name says something else.
  coalesce(p.current_name, u.display_name, 'Unknown member') as display_name
from public.app_users u
left join public.players p on p.player_id = u.player_id
where (
    public.current_app_role() in ('member', 'officer', 'admin')
    or public.is_service_request()
  )
  and (
    exists (select 1 from public.guides g where g.created_by = u.user_id)
    or exists (select 1 from public.announcements a where a.created_by = u.user_id)
  );

comment on view public.post_authors is
  'Author uuid to a name: their character, else the display name an admin gave '
  'the account, else "Unknown member". Narrowed to people who have written a '
  'guide or a notice on purpose — the boards need to name whoever wrote what '
  'you are reading, not to publish the account-to-character link for everybody.';

grant select on public.post_authors to authenticated;
