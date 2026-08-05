-- 0067: someone who left the alliance stops being a member.
--
-- The roster asked `players` for rows whose `current_alliance_id` is ours.
-- Nothing ever clears that column — every writer since 0008 sets it as
-- `coalesce(s.alliance_id, p.current_alliance_id)`, which is precisely a
-- rule for never forgetting. A member who leaves keeps their badge forever,
-- and the roster grows monotonically whatever the alliance actually does.
--
-- Departure does not need to be recorded, because it is already in the data:
-- one `al.rank` response is the WHOLE roster. Verified on this database —
-- eleven captured batches, 79 to 99 rows each, every row of a batch sharing
-- one `captured_at`. So "who is in the alliance" is the newest batch, and
-- "who left" is anyone in an older batch and not in that one. Derived, so
-- there is no writer to forget and nothing to backfill.
--
-- THE TRAP, and why `snapshot_complete` exists.
--
-- Our own alliance holds ten batches. Six of them, all from July, carry 92
-- or 93 rows for an alliance the game reports as 94; the four from August
-- carry 94. The short ones are not one or two departures each — they are
-- captures where the member list was not scrolled to the end. A view that
-- trusted "newest batch = truth" would have announced a departure every
-- time one of those happened to be newest, and the reader would have had no
-- way to tell that from the real thing.
--
-- The real thing, for the record: against those same ten batches this finds
-- exactly two departures, last seen on 2026-07-28 and 2026-07-30, both from
-- a newest batch of 94 that matches the count.
--
-- So the batch is measured against `alliances.member_count`, which comes
-- from the game's own `curMember`. A batch at least as large as that count
-- is complete; a smaller one is a partial capture, its absences are
-- unconfirmed, and the view says so instead of guessing. `member_count`
-- itself can be stale, which is why this marks confidence rather than
-- filtering — a screen that hides uncertain answers is a screen that hides
-- real departures too.

-- WHY THESE TWO ARE DEFINER VIEWS, when 0035 and 0049 argued for invoker.
--
-- 0066 narrowed `alliance_member_snapshots` to officer/admin or the caller's
-- own linked player, and said so for a good reason: the table is a member's
-- HISTORY, one row per capture, and "every member reads every member's power
-- over time" is not the same question as "who is in the alliance".
--
-- Membership is the second question, and members can already answer it —
-- `players` is member-readable and the roster has always been built from it.
-- What these views add is not access to history; it is the correction that
-- `players.current_alliance_id` never applies. An invoker view would hand an
-- ordinary member a roster of exactly one person: themselves.
--
-- So they are definer, and the gate is written into the predicate instead:
-- role in (member, officer, admin), enumerated rather than compared because
-- app_role sorts collector_service and analyst_service above admin (0066's
-- own warning). What escapes is one row per current member and one per
-- departure — the newest sighting only, the same figures `players` already
-- carries. No time series, no `raw`, no month card. 0066's restriction on
-- the base table is untouched, and 36_alliance_departures_test proves a
-- member still cannot select from it directly.
create view public.alliance_roster_latest as
with newest as (
  select alliance_id, max(captured_at) as captured_at
  from public.alliance_member_snapshots
  group by alliance_id
),
sized as (
  select
    s.alliance_id,
    s.captured_at,
    count(*) as observed_members
  from public.alliance_member_snapshots s
  join newest n
    on n.alliance_id = s.alliance_id and n.captured_at = s.captured_at
  group by s.alliance_id, s.captured_at
)
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
  sized.observed_members,
  a.member_count as expected_members,
  -- Null expectation is not a failed check: an alliance we have never seen
  -- a member count for is simply unmeasured, and calling that "incomplete"
  -- would mark every departure unconfirmed forever.
  (a.member_count is null or sized.observed_members >= a.member_count)
    as snapshot_complete
from public.alliance_member_snapshots s
join sized
  on sized.alliance_id = s.alliance_id and sized.captured_at = s.captured_at
join public.alliances a on a.alliance_id = s.alliance_id
where public.current_app_role() in ('member', 'officer', 'admin');

comment on view public.alliance_roster_latest is
  'Who is in each alliance, from the newest al.rank batch. '
  'observed_members/expected_members/snapshot_complete carry whether that '
  'batch saw the whole roster, because a half-scrolled capture is '
  'indistinguishable from a mass departure without them.';

-- Anyone we have seen in the alliance who is not in the newest batch.
-- Definer for the same reason, and gated the same way.
create view public.alliance_departures as
with newest as (
  select alliance_id, max(captured_at) as captured_at
  from public.alliance_member_snapshots
  group by alliance_id
),
current_members as (
  select s.alliance_id, s.game_uid
  from public.alliance_member_snapshots s
  join newest n
    on n.alliance_id = s.alliance_id and n.captured_at = s.captured_at
),
history as (
  select
    s.alliance_id,
    s.game_uid,
    max(s.captured_at) as last_seen_in_alliance_at,
    min(s.captured_at) as first_seen_in_alliance_at
  from public.alliance_member_snapshots s
  group by s.alliance_id, s.game_uid
)
select distinct on (h.alliance_id, h.game_uid)
  h.alliance_id,
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
  r.snapshot_complete as confirmed
from history h
join newest n on n.alliance_id = h.alliance_id
join public.alliance_member_snapshots s
  on s.alliance_id = h.alliance_id
 and s.game_uid = h.game_uid
 and s.captured_at = h.last_seen_in_alliance_at
join lateral (
  select bool_and(rl.snapshot_complete) as snapshot_complete
  from public.alliance_roster_latest rl
  where rl.alliance_id = h.alliance_id
) r on true
where public.current_app_role() in ('member', 'officer', 'admin')
  and not exists (
    select 1 from current_members c
    where c.alliance_id = h.alliance_id and c.game_uid = h.game_uid
  )
order by h.alliance_id, h.game_uid, h.last_seen_in_alliance_at desc;

comment on view public.alliance_departures is
  'Members seen in an alliance but absent from its newest al.rank batch, '
  'with the state they were last seen in. `confirmed` is false when that '
  'batch did not cover the whole roster — an unscrolled capture looks '
  'exactly like a departure and must not be reported as one.';

-- authenticated only, and the predicate above does the rest. A definer view
-- granted to anon would be a hole straight through 0065, which is precisely
-- what 34_no_public_read_test walks the schema to catch.
grant select on public.alliance_roster_latest to authenticated;
grant select on public.alliance_departures to authenticated;
