-- 0333: join_roster — the current members' names, for the join screen.
--
-- WHY. Joining is one screen since 2026-11-18: invitation code and "which
-- character are you" on one form. The owner wants the character as a
-- dropdown of the CURRENT members, but an account that has not redeemed a
-- code is a viewer, and viewers cannot read `players` (0065). This function
-- is the one narrow door: names, game uid and alliance code of the latest
-- roster of our own alliances, and nothing else.
--
-- WHAT IT GIVES AWAY, deliberately. Any signed-in account (not anon) can read
-- the member list of our alliances. The same list is open in game to anyone
-- who taps the alliance, so this exposes no more than the game does; power,
-- kills and history stay behind 0065.
--
-- MEMBERSHIP FROM alliance_roster_latest (CLAUDE.md), never
-- players.current_alliance_id, which never forgets a departure.

create function public.join_roster(p_alliance uuid default null)
returns table (
  player_id uuid,
  name text,
  game_uid bigint,
  alliance_id uuid,
  alliance_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return query
    select r.player_id, coalesce(p.current_name, r.name), r.game_uid, a.alliance_id, a.current_code
      from public.alliance_roster_latest r
      join public.alliances a on a.alliance_id = r.alliance_id and a.is_own
      left join public.players p on p.player_id = r.player_id
     where r.player_id is not null
       and (p_alliance is null or r.alliance_id = p_alliance)
     order by lower(coalesce(p.current_name, r.name));
end;
$$;

revoke all on function public.join_roster(uuid) from public, anon;
grant execute on function public.join_roster(uuid) to authenticated;

comment on function public.join_roster(uuid) is
  'Latest roster of our own alliances (name, game uid, alliance code) for the '
  'join screen, readable by any signed-in account including a viewer (0333). '
  'Nothing beyond what the game shows anyone.';
