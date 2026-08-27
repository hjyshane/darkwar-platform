-- 0150: the two roster views compute per ALLIANCE, not per group.
--
-- 0149 fixed the season board by moving it off `alliance_roster_latest`. This
-- fixes the view itself, because two live screens still read it, and one of
-- them is the one the alliance lands on.
--
-- Measured on production as service_role — RLS bypassed, so none of this is
-- the per-row RLS cost of 0104/0105:
--
--   alliance_roster_latest, `alliance_id=eq.<one>`        0.30 s
--   alliance_roster_latest, `alliance_id=in.(same one)`   6.05 s
--   alliance_departures,    `alliance_id=eq.<one>`        4.19 s
--   alliance_departures,    no filter                     TIMEOUT
--
-- THE FIRST TWO ROWS ARE THE SAME ALLIANCE. The only difference is how
-- PostgREST spelled the filter, and a twenty-fold difference hangs on it:
-- `eq` becomes an equality qual the planner pushes below the `group by
-- alliance_id`, so the aggregate reads one alliance's index entries; `in`
-- becomes `= any (array[...])`, which it does not push, so the same query
-- aggregates `alliance_member_snapshots` — 1,757,827 rows — for all 256
-- alliances to answer about one. The overview panel uses `.in()`, because it
-- accepts a list of own alliances. So the landing screen has been paying 6 s
-- for a filter it thought it had applied, and a member session adds per-row
-- RLS on top of that.
--
-- A screen must not be fast or slow depending on which PostgREST operator a
-- caller happened to pick. So the aggregates stop being whole-table CTEs and
-- become LATERALs correlated to `alliances`: the filter now lands on
-- `alliances.alliance_id` — a primary key, which both `eq` and `in` use — and
-- everything below it is an index descent on
-- `alliance_member_snapshots_alliance_captured_idx` (alliance_id,
-- captured_at desc), which has existed since 0003 and was unreachable through
-- the group-by. This is 0103's fix applied to the view 0103 was working
-- around.
--
-- SEMANTICS ARE UNCHANGED and that is the point of the rewrite rather than a
-- redesign. `snapshot_complete` still measures the newest batch against
-- `alliances.member_count`, still tolerates a null count, and still marks
-- confidence instead of filtering — 0067 explains at length why a
-- half-scrolled capture must not be reported as a mass departure, and none of
-- that reasoning changes when the arithmetic moves under a LATERAL. Verified
-- against production before and after: 82 roster rows and 16 departures for
-- the own alliance, 7,431 roster rows across all of them.
--
-- Driving from `alliances` rather than from the snapshots loses no rows:
-- `alliance_member_snapshots.alliance_id` is `not null references
-- public.alliances` (0003), so every alliance with history has a row there.
--
-- Both views stay DEFINER with the role predicate written into the body, for
-- the reason 0067 gives: membership is a question members may ask, while
-- `alliance_member_snapshots` is a member's history and 0066 keeps that shut.
-- Nothing here touches that boundary; 36_alliance_departures_test still
-- proves a member cannot read the base table directly.

create or replace view public.alliance_roster_latest as
select
  s.snapshot_id,
  s.alliance_id,
  s.server_id,
  s.player_id,
  s.game_uid,
  s.name,
  s.member_rank,
  s.hq_level,
  s.power,
  s.kills,
  s.captured_at,
  b.observed_members,
  a.member_count as expected_members,
  -- Null expectation is not a failed check: an alliance we have never seen
  -- a member count for is simply unmeasured, and calling that "incomplete"
  -- would mark every departure unconfirmed forever.
  (a.member_count is null or b.observed_members >= a.member_count)
    as snapshot_complete
from public.alliances a
-- The newest batch for THIS alliance: an index descent, not a group-by over
-- every alliance's history.
cross join lateral (
  select max(m.captured_at) as captured_at
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
) n
join public.alliance_member_snapshots s
  on s.alliance_id = a.alliance_id
 and s.captured_at = n.captured_at
-- How many rows that batch holds — the number `snapshot_complete` weighs
-- against the game's own member count.
cross join lateral (
  select count(*) as observed_members
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
    and m.captured_at = n.captured_at
) b
where public.current_app_role() in ('member', 'officer', 'admin');

comment on view public.alliance_roster_latest is
  'Who is in each alliance, from the newest al.rank batch. '
  'observed_members/expected_members/snapshot_complete carry whether that '
  'batch saw the whole roster, because a half-scrolled capture is '
  'indistinguishable from a mass departure without them. Computed per '
  'alliance through LATERALs so a filter reaches the index (0150).';

create or replace view public.alliance_departures as
select distinct on (a.alliance_id, h.game_uid)
  a.alliance_id,
  h.game_uid,
  s.player_id,
  s.name as last_known_name,
  s.member_rank as last_member_rank,
  s.hq_level as last_hq_level,
  s.power as last_power,
  s.kills as last_kills,
  h.first_seen_in_alliance_at,
  h.last_seen_in_alliance_at,
  n.captured_at as roster_captured_at,
  -- The same qualifier the roster view carries, repeated here because this
  -- is where a reader acts on it: false means "absent from a capture that
  -- did not see the whole list", which is a maybe, not a departure.
  --
  -- 0067 computed this as `bool_and(snapshot_complete)` over a lateral into
  -- alliance_roster_latest — which re-entered that whole view once per
  -- departure. It is the same value: snapshot_complete is constant within an
  -- alliance, so the aggregate was always folding one distinct value.
  (a.member_count is null or b.observed_members >= a.member_count)
    as confirmed
from public.alliances a
cross join lateral (
  select max(m.captured_at) as captured_at
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
) n
cross join lateral (
  select count(*) as observed_members
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
    and m.captured_at = n.captured_at
) b
-- Everyone ever seen in THIS alliance, with the window they were seen in.
join lateral (
  select
    m.game_uid,
    max(m.captured_at) as last_seen_in_alliance_at,
    min(m.captured_at) as first_seen_in_alliance_at
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
  group by m.game_uid
) h on true
join public.alliance_member_snapshots s
  on s.alliance_id = a.alliance_id
 and s.game_uid = h.game_uid
 and s.captured_at = h.last_seen_in_alliance_at
where public.current_app_role() in ('member', 'officer', 'admin')
  -- Absent from the newest batch. 0067 spelled this as a NOT EXISTS against
  -- that batch's members; since last_seen_in_alliance_at IS this member's
  -- newest sighting in the alliance, "not in the newest batch" and "last seen
  -- before it" are the same statement, and this one needs no second pass.
  and h.last_seen_in_alliance_at < n.captured_at
order by a.alliance_id, h.game_uid, h.last_seen_in_alliance_at desc;

comment on view public.alliance_departures is
  'Members seen in an alliance but absent from its newest al.rank batch, '
  'with the state they were last seen in. `confirmed` is false when that '
  'batch did not cover the whole roster — an unscrolled capture looks '
  'exactly like a departure and must not be reported as one. Computed per '
  'alliance through LATERALs so a filter reaches the index (0150).';
