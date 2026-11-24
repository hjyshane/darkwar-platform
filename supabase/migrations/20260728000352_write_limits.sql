-- 0352: write_limits - the two writes a signed-in member could repeat without
-- limit, and one of them closed rather than limited.
--
-- WHY. The 2026-11-24 review asked whether anything a member can write has no
-- per-user limit (docs/reviews/website-review-2026-11-24.md §5). Every write a
-- member reaches was listed from a fully migrated database: the functions
-- authenticated may execute, and the policies that let it insert or update.
-- Almost all are bounded already - by a capability only officers hold, or by
-- a unique key (activity once a day per kind, one claim per account, one
-- favourite or read mark per post). Two were not:
--
--   1. COMMENTS. Any member may insert into post_comments, and each insert
--      also writes a reply notice for the post's author and a realtime
--      notification for every open board. Nothing stopped a loop.
--      -> A trigger refuses an account's sixth comment inside a minute and
--         its sixtieth inside an hour. Generous for a person, a wall for a
--         script. Refusing is right here: there is no counter to keep, the
--         insert itself is what is turned away.
--
--   2. THE FIVE REFRESH FUNCTIONS (refresh_alliance_growth, _alliance_latest,
--      _member_roster, _member_roster_players, _player_season_buildings).
--      Each rebuilds a "current" table from snapshots - the heaviest work in
--      the schema - and authenticated could call any of them directly, as
--      often as it liked. The dashboard never does: they run from triggers on
--      the snapshot tables, which only the collector (service role) and
--      definer functions (the owner) write.
--      -> EXECUTE is revoked from authenticated and public. The triggers keep
--         working: they run as whoever wrote the snapshot, and neither of
--         those writers is authenticated. 64's "a member may refresh" became
--         "a member may not call it".
--
-- Judged and left alone: record_post_view lets a member add one to a post's
-- daily view count per call (a vanity number, no fan-out); planner_plans has
-- no per-account cap (rows only its owner reads). Officer and admin writes
-- (gift codes, alarms' Send now, settings) are trusted by role.

-- 1. -------------------------------------------------------------- comments

create index post_comments_author_recent_idx
  on public.post_comments (author_user_id, created_at desc);

create function public.post_comments_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_minute int;
  v_hour int;
begin
  -- The collector and definer jobs write as nobody; only a person is limited.
  if v_uid is null then
    return new;
  end if;
  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*)
    into v_minute, v_hour
    from public.post_comments
   where author_user_id = v_uid
     and created_at > now() - interval '1 hour';
  if v_minute >= 5 or v_hour >= 59 then
    raise exception 'too many comments: wait a minute, then try again'
      using errcode = 'DW429',
            hint = 'At most 5 comments a minute and 59 an hour per account (0352).';
  end if;
  return new;
end;
$$;

comment on function public.post_comments_throttle() is
  'Refuses an account''s sixth comment in a minute or sixtieth in an hour (0352), '
  'with SQLSTATE DW429, which the dashboard shows as "commenting too fast".';

revoke all on function public.post_comments_throttle() from public, anon, authenticated;

create trigger post_comments_throttle
  before insert on public.post_comments
  for each row execute function public.post_comments_throttle();

-- 2. -------------------------------------------------------- the refreshes

revoke execute on function public.refresh_alliance_growth(uuid[]) from public, anon, authenticated;
revoke execute on function public.refresh_alliance_latest(text[]) from public, anon, authenticated;
revoke execute on function public.refresh_member_roster() from public, anon, authenticated;
revoke execute on function public.refresh_member_roster_players(uuid[]) from public, anon, authenticated;
revoke execute on function public.refresh_player_season_buildings(uuid[]) from public, anon, authenticated;
