-- 0176: what an officer can type in when the collector cannot run.
--
-- Two things go missing when nobody is capturing: the weekly scores the rank
-- is built from, and the roster that says who is being ranked. Both are
-- written here as ORDINARY SNAPSHOT ROWS, in the tables the collector writes,
-- rather than into a side table every reader would then have to learn about.
-- That is what lets the collector's data join up with them later without a
-- merge step: the readers already decide between rows, and the rows below are
-- shaped so that the decision comes out the way it should.
--
-- Provenance is the snapshot convention's own: `collector_id` names a
-- "manual entry" collector, `source_command` is `manual.contribution` or
-- `manual.roster`, and `raw` says who typed it. Nothing below needs a new
-- column to tell a typed row from a captured one.
--
-- THE RULE FOR SCORES: THE COLLECTOR ALWAYS WINS. Typed scores fill a gap;
-- they never overrule a reading. Every reader of a weekly score takes the
-- NEWEST row inside the week (build_rank_period, 0164;
-- member_current_period_contribution, 0157; player_contributions, 0029), so
-- a typed row is stamped at the very start of its week — one second after
-- the reset, plus a millisecond per earlier entry for the same member and
-- board. Any capture made in that week, even one synced a month later, is
-- newer and is read instead. A second typed value for the same week is newer
-- than the first, so a correction takes.
--
-- The one gap: a capture inside the first minute after the Monday reset
-- would lose to a typed row. The boards are all zeroes then and no sweep has
-- ever run at 02:00, so this is noted rather than engineered around.
--
-- THE RULE FOR THE ROSTER: THE NEWEST BATCH IS THE ROSTER, as it always has
-- been (alliance_roster_latest, 0152). A single typed row would therefore BE
-- the roster — one member — and everyone else would read as departed. So a
-- change is written as a whole new batch: the current roster copied forward
-- at one new instant, with the one member added or left out. The next al.rank
-- the collector captures is newer again and simply replaces it, which is the
-- "joins up later" half for free.

-- The collector every typed row is attributed to. `collector_id` is a
-- foreign key on every snapshot table (0004), and a row of its own is the
-- honest answer to "which machine saw this": none did.
insert into public.collectors (name, status, version)
values ('manual entry', 'offline', 'manual-1')
on conflict (name) do nothing;

insert into public.capabilities (capability, label, description, sort_order) values
  ('data.enter', 'Enter data by hand',
   'Type in weekly duel and donation scores, and add or remove roster members, '
   'for the weeks the collector could not run. A captured reading always wins.', 120);

-- Officers hold it, for the same reason as hive.plan: the collector going
-- down is an R4 problem, and waiting on an admin is how a fortnight's rank
-- gets built from an empty week.
insert into public.role_permissions (role, capability, allowed)
select r.role, 'data.enter', r.role in ('officer', 'admin')
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role);

-- Weekly totals for one game week, many members at once.
--
-- p_entries: [{ "player_id": uuid, "duel": bigint|null, "donation": bigint|null }]
-- A null leaves that board untouched. Returns how many rows were written.
create function public.enter_weekly_scores(p_week_start timestamptz, p_entries jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collector uuid;
  v_observation uuid := gen_random_uuid();
  v_written int;
  v_missing uuid;
begin
  if not public.has_permission('data.enter') then
    raise exception 'entering scores by hand requires the data.enter permission'
      using errcode = '42501';
  end if;
  -- The week is named by its reset instant, and only that instant. Anything
  -- else is a timestamp somebody computed differently, and the row would
  -- land in whichever week it happened to fall in.
  if p_week_start is null or p_week_start <> public.reset_week_start(p_week_start) then
    raise exception 'the week must be given as its Monday 02:00 UTC reset'
      using errcode = '22023';
  end if;
  if p_week_start > now() then
    raise exception 'that week has not started yet' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'the entries must be a json array of {player_id, duel, donation} objects'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_entries) as e(duel bigint, donation bigint)
     where e.duel < 0 or e.donation < 0
  ) then
    raise exception 'a score cannot be negative' using errcode = '22023';
  end if;
  -- Twice in one call is two values for one week with nothing to say which
  -- is meant, and both would be stamped the same instant.
  select e.player_id into v_missing
    from jsonb_to_recordset(p_entries) as e(player_id uuid)
   group by e.player_id having count(*) > 1
   limit 1;
  if found then
    raise exception 'player % appears more than once', v_missing using errcode = '23505';
  end if;

  -- Only players the collector has seen: their game_uid is what a later
  -- capture is matched on, and a row for somebody unknown could never join up.
  select e.player_id into v_missing
    from jsonb_to_recordset(p_entries) as e(player_id uuid)
    left join public.players p on p.player_id = e.player_id
   where p.player_id is null
   limit 1;
  if found then
    raise exception 'player % is not one the collector has ever seen', v_missing
      using errcode = '23503';
  end if;

  select collector_id into v_collector from public.collectors where name = 'manual entry';

  insert into public.alliance_contribution_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     score_updated_at, collector_id, collected_from_server_id, raw,
     server_id, player_id, game_uid, contribution_type, score)
  select
    v_observation, 'manual.contribution', 'manual-1',
    'manual:' || t.kind || ':' || t.game_uid || ':' || extract(epoch from p_week_start)::bigint
      || ':' || t.seq,
    t.stamp, t.stamp, v_collector, t.server_id,
    jsonb_build_object('entered_by', auth.uid(), 'entered_at', now()),
    t.server_id, t.player_id, t.game_uid, t.kind, t.score
  from (
    select
      p.player_id, p.game_uid, p.server_id, b.kind, b.score,
      -- See the header: one second past the reset, a millisecond per earlier
      -- typed value for the same member, board and week.
      (select count(*) from public.alliance_contribution_snapshots s
        where s.game_uid = p.game_uid
          and s.contribution_type = b.kind
          and s.source_command = 'manual.contribution'
          and s.captured_at > p_week_start
          and s.captured_at < p_week_start + interval '1 minute') as seq,
      p_week_start + interval '1 second'
        + (select count(*) from public.alliance_contribution_snapshots s
            where s.game_uid = p.game_uid
              and s.contribution_type = b.kind
              and s.source_command = 'manual.contribution'
              and s.captured_at > p_week_start
              and s.captured_at < p_week_start + interval '1 minute')
          * interval '1 millisecond' as stamp
    from jsonb_to_recordset(p_entries) as e(player_id uuid, duel bigint, donation bigint)
    join public.players p on p.player_id = e.player_id
    cross join lateral (values
      ('alliance_battle_weekly', e.duel),
      ('weekly_donation', e.donation)
    ) as b(kind, score)
    where b.score is not null
  ) t;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function public.enter_weekly_scores(timestamptz, jsonb) is
  'Type in weekly duel and donation totals for one game week. Written as '
  'ordinary snapshot rows stamped at the start of the week, so any capture '
  'from that week is newer and wins. data.enter.';

grant execute on function public.enter_weekly_scores(timestamptz, jsonb) to authenticated;

-- What the entry screen shows for a week: each current member's reading on
-- both boards, and whether that reading was typed or captured.
--
-- ONE ROW PER MEMBER, folded here rather than in the browser: a week of
-- sweeps is thousands of snapshot rows, PostgREST stops at 1,000 without
-- saying so, and the screen would show some members as blank that are not.
--
-- The same "newest inside the week" rule every reader uses, so what this says
-- is the value the rank will be built from. Security invoker: whoever may
-- not read the snapshots gets nothing.
create function public.week_scores(p_week_start timestamptz)
returns table (
  player_id uuid,
  current_name text,
  duel bigint,
  duel_typed boolean,
  donation bigint,
  donation_typed boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.player_id,
    p.current_name,
    d.score,
    d.source_command = 'manual.contribution',
    g.score,
    g.source_command = 'manual.contribution'
  from public.member_roster_current r
  join public.players p on p.player_id = r.player_id
  left join lateral (
    select s.score, s.source_command
      from public.alliance_contribution_snapshots s
     where s.game_uid = p.game_uid
       and s.contribution_type = 'alliance_battle_weekly'
       and s.captured_at > p_week_start
       and s.captured_at <= p_week_start + interval '7 days' - interval '1 minute'
     order by s.captured_at desc
     limit 1
  ) d on true
  left join lateral (
    select s.score, s.source_command
      from public.alliance_contribution_snapshots s
     where s.game_uid = p.game_uid
       and s.contribution_type = 'weekly_donation'
       and s.captured_at > p_week_start
       and s.captured_at <= p_week_start + interval '7 days' - interval '1 minute'
     order by s.captured_at desc
     limit 1
  ) g on true
  order by p.current_name;
$$;

grant execute on function public.week_scores(timestamptz) to authenticated;

-- Put one member on the roster, or take one off.
--
-- Writes the current roster forward as a new batch (see the header). The
-- copied rows take their name, HQ, power and kills from `players`, not from
-- the batch they were copied out of: apply_roster_summary (0030) writes
-- those back onto `players` because the batch looks newest, and an old
-- batch's power would overwrite a fresher one from the server ranking.
--
-- Presence is marked redacted, which is what makes apply_roster_summary skip
-- it: nobody looked, so nobody may be reported online at this instant.
--
-- `alliances.member_count` is set to the new size. The roster views call a
-- batch complete when it holds that many (0152); leaving the game's old count
-- in place would mark every departure since as "unconfirmed" because of an
-- edit the officer made on purpose. The next alliance capture resets it.
create function public.set_roster_membership(p_player_id uuid, p_member boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid;
  v_server int;
  v_latest timestamptz;
  v_collector uuid;
  v_observation uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_on boolean;
  v_count int;
begin
  if not public.has_permission('data.enter') then
    raise exception 'changing the roster by hand requires the data.enter permission'
      using errcode = '42501';
  end if;
  if p_player_id is null or p_member is null then
    raise exception 'say who, and whether they are in or out' using errcode = '22023';
  end if;

  select count(*) into v_count from public.alliances where is_own;
  if v_count <> 1 then
    raise exception 'there must be exactly one alliance marked as ours (found %)', v_count
      using errcode = '22023';
  end if;
  select alliance_id, server_id into v_alliance, v_server
    from public.alliances where is_own;

  if not exists (
    select 1 from public.players where player_id = p_player_id
  ) then
    raise exception 'player % is not one the collector has ever seen', p_player_id
      using errcode = '23503';
  end if;

  select max(captured_at) into v_latest
    from public.alliance_member_snapshots where alliance_id = v_alliance;

  select exists (
    select 1 from public.alliance_member_snapshots
     where alliance_id = v_alliance and captured_at = v_latest and player_id = p_player_id
  ) into v_on;
  if p_member and v_on then
    raise exception 'that player is already on the roster' using errcode = '23505';
  end if;
  if not p_member and not v_on then
    raise exception 'that player is not on the roster' using errcode = 'P0002';
  end if;

  select collector_id into v_collector from public.collectors where name = 'manual entry';

  insert into public.alliance_member_snapshots
    (observation_id, source_command, parser_version, idempotency_key, captured_at,
     collector_id, collected_from_server_id, raw,
     alliance_id, server_id, player_id, game_uid, name, member_rank, hq_level, power, kills,
     presence_redacted)
  select
    v_observation, 'manual.roster', 'manual-1',
    'manual:roster:' || v_observation || ':' || r.game_uid,
    v_now, v_collector, v_server,
    jsonb_build_object(
      'entered_by', auth.uid(),
      'action', case when p_member then 'add' else 'remove' end,
      'subject', p_player_id,
      'copied_from', r.snapshot_id),
    v_alliance, r.server_id, r.player_id, r.game_uid, r.name, r.member_rank,
    r.hq_level, r.power, r.kills, true
  from (
    select s.snapshot_id, coalesce(p.server_id, s.server_id) as server_id, s.player_id,
           s.game_uid, coalesce(p.current_name, s.name) as name, s.member_rank,
           coalesce(p.hq_level, s.hq_level) as hq_level, coalesce(p.power, s.power) as power,
           coalesce(p.kills, s.kills) as kills
      from public.alliance_member_snapshots s
      left join public.players p on p.player_id = s.player_id
     where s.alliance_id = v_alliance
       and s.captured_at = v_latest
       and s.player_id is distinct from p_player_id
    union all
    -- The one being added. Their rank is the last one this alliance gave
    -- them if they have been a member before, and R1 if not — the rank a
    -- new recruit joins at.
    select null, p.server_id, p.player_id, p.game_uid, p.current_name,
           coalesce((select m.member_rank from public.alliance_member_snapshots m
                      where m.alliance_id = v_alliance and m.player_id = p.player_id
                      order by m.captured_at desc limit 1), 1),
           p.hq_level, p.power, p.kills
      from public.players p
     where p_member and p.player_id = p_player_id
  ) r;
  get diagnostics v_count = row_count;

  update public.alliances set member_count = v_count where alliance_id = v_alliance;
  return v_count;
end;
$$;

comment on function public.set_roster_membership(uuid, boolean) is
  'Add one member to our alliance roster, or remove one, by writing the '
  'current roster forward as a new batch. The next captured roster is newer '
  'and replaces it. data.enter.';

grant execute on function public.set_roster_membership(uuid, boolean) to authenticated;

-- The daily chart leaves typed rows out. A typed weekly total is stamped a
-- second after Monday's reset, so here it would read as the whole week's
-- score earned on Monday. Otherwise identical to 0151.
create or replace view public.alliance_daily_contribution as
with best as (
  select
    a.alliance_id,
    date_trunc('day', s.captured_at - interval '2 hours') + interval '2 hours' as game_day,
    s.contribution_type as kind,
    s.game_uid,
    max(s.score) as score,
    max(s.captured_at) as last_capture_at,
    count(*) as readings
  from public.alliances a
  join lateral (
    select distinct m.game_uid
    from public.alliance_member_snapshots m
    where m.alliance_id = a.alliance_id
  ) r on true
  join public.alliance_contribution_snapshots s
    on s.game_uid = r.game_uid
   and s.score is not null
   and s.source_command <> 'manual.contribution'
  group by 1, 2, 3, 4
)
select
  alliance_id,
  game_day,
  kind,
  sum(score) as total,
  count(*) as members_counted,
  round(avg(score)) as avg_per_member,
  max(last_capture_at) as last_capture_at,
  max(readings) as readings
from best
where (public.current_app_role() in ('member', 'officer', 'admin')
        or public.is_service_request())
group by alliance_id, game_day, kind;
