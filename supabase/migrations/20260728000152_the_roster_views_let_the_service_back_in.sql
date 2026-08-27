-- 0152: 0150 locked the service out of the two views it rewrote.
--
-- 0150 restructured `alliance_roster_latest` and `alliance_departures` from
-- 0067's text. But 0067 is not where their predicate last changed: 0077 added
-- `or public.is_service_request()` to both, so a service-key request — which
-- has no `auth.uid()` and therefore no row in `app_users`, so
-- `current_app_role()` cannot answer for it — could still read them.
--
-- Rewriting from the older definition silently reverted that. Caught by
-- diffing production output before and after the push: 82 roster rows and 16
-- departures became 0 and 0, while `alliance_daily_contribution` — rewritten
-- in the same batch but read out of 0077, which is where its body lives —
-- came back byte-identical.
--
-- Nothing here changes what 0150 did to the shape of the queries. This
-- restores one disjunct to two WHERE clauses.
--
-- The lesson is the one CLAUDE.md already carries and this session paid for
-- anyway: a view's current definition is the LAST migration that touched it,
-- not the one that introduced it, and finding that means grepping the whole
-- of supabase/ rather than opening the file the comment points at.

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
  (a.member_count is null or b.observed_members >= a.member_count)
    as snapshot_complete
from public.alliances a
cross join lateral (
  select max(m.captured_at) as captured_at
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
) n
join public.alliance_member_snapshots s
  on s.alliance_id = a.alliance_id
 and s.captured_at = n.captured_at
cross join lateral (
  select count(*) as observed_members
  from public.alliance_member_snapshots m
  where m.alliance_id = a.alliance_id
    and m.captured_at = n.captured_at
) b
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request());

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
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
  and h.last_seen_in_alliance_at < n.captured_at
order by a.alliance_id, h.game_uid, h.last_seen_in_alliance_at desc;
