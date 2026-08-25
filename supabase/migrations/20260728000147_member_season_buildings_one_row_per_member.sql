-- 0147: one row per member, so a limit counts PEOPLE.
--
-- The board showed 67 of 84 members. The cause was not a join and not a gap
-- in what had been observed: PostgREST caps a response at 1,000 rows and
-- ignores a larger `limit`. `member_season_buildings` returns a row per
-- (member, building type) — about eighteen each — so 84 members are 1,198
-- rows, the last 198 were cut, and the members inside them vanished from the
-- screen without a word.
--
-- THIS IS THE THIRD TIME TODAY. 0140's server list reduced raw tiles in the
-- browser and an ordered limit dropped whole servers; 0144's map filter
-- counted pans instead of players and dropped anyone seen once a while ago.
-- Same shape every time: a limit that counts rows while the reader counts
-- people, and the difference disappearing in silence.
--
-- Folding the buildings into one JSON object per member makes the row count
-- the member count, so 84 members are 84 rows and no cap is anywhere near.
-- It also means a client cannot reintroduce the bug by passing a limit that
-- looked generous.
--
-- `levels` is keyed by building_type_id as text, because that is what JSON
-- object keys are; the dashboard already looks buildings up by id and knows
-- which season's catalogue it is rendering.

create or replace view public.member_season_buildings_by_member
with (security_invoker = true) as
select
  b.player_id,
  min(b.current_name)          as current_name,
  min(b.game_uid)              as game_uid,
  min(b.server_id)             as server_id,
  -- The newest level per building type, already reduced by the view below.
  jsonb_object_agg(b.building_type_id::text, b.level)
    filter (where b.level is not null)                as levels,
  -- The OLDEST sighting among this member's buildings: a row is only as
  -- fresh as its stalest cell, since one pan sees part of a plot.
  min(b.captured_at)           as oldest_seen,
  max(b.captured_at)           as newest_seen
from public.member_season_buildings b
group by b.player_id;

comment on view public.member_season_buildings_by_member is
  'One row per roster member, buildings folded into a jsonb of type id -> level. Exists so a client limit counts members rather than rows: PostgREST caps responses at 1000, and the per-building view exceeded that at 84 members.';

grant select on public.member_season_buildings_by_member to authenticated;
