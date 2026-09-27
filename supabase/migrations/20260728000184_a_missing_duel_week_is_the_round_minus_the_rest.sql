-- 0184: a duel week nobody opened is worked out from the round total.
--
-- The weekly duel board is captured only when somebody opens its tab, so
-- whole weeks go missing (2026-08-17, 2026-09-14). The ROUND board is
-- cumulative over the round's four weeks, which is what makes a missing week
-- recoverable:
--
--     missing week = round total - (every other week of the round so far)
--
-- all read at the same instant. It was done by hand once, on 2026-08-30
-- (`derived:round-minus-week2`, 82 rows). This does the same thing on a clock.
--
-- ROUNDS. Four weeks, the first beginning 2026-08-17 02:00 UTC. Confirmed from
-- the boards themselves: the round reading taken in week 2026-09-14's
-- successor is the weekly reading plus a 501M remainder, and the one taken on
-- 2026-09-12 is 2.36B, i.e. still the old round. If the game ever changes the
-- round length, the arithmetic goes negative for somebody; a week where ANY
-- member comes out negative is therefore written for nobody.
--
-- WHICH READINGS. For a missing week M, the first week k >= M of the same
-- round that has a usable reading:
--   k > M  - a round reading and a weekly reading taken within two minutes of
--            each other in week k. Week k's in-flight score cancels.
--   k = M  - a round reading taken in week M after its duel ended (Sunday
--            02:00 UTC, six days in). Only then is the figure final.
-- plus, for every other week before k, that week's final weekly reading (also
-- taken after its duel ended). A member missing from any board involved is
-- skipped, not assumed zero.
--
-- A PAIR TAKEN AFTER THE DUEL ENDED IS PREFERRED, then the closest pair, then
-- the latest. Before Sunday the two boards move between two captures; after
-- it they are frozen and the difference is exact. A better pair arriving later
-- overwrites the value (same idempotency key), so a mid-week estimate is
-- corrected by the Sunday sweep without anybody noticing.
--
-- THE COLLECTOR STILL WINS. Derived rows are stamped 30 seconds after the
-- week's reset: newer than a typed value (0176 stamps those one second in, so
-- exact arithmetic beats typing), older than any capture. A week counts as
-- missing only when it has no weekly row other than typed or derived ones, so
-- once a real capture of the week lands nothing more is derived for it — and
-- the readers, taking the newest row in the week, already prefer the capture.

-- The batch-level lookups below ask "which instants in this week have a
-- board". Neither existing index leads with contribution_type, and the
-- weekly/round boards are a small slice of the table.
create index if not exists alliance_contribution_snapshots_duel_board_idx
  on public.alliance_contribution_snapshots (contribution_type, captured_at)
  where contribution_type in ('alliance_battle_weekly', 'alliance_battle_round');

create function internal.duel_round_anchor()
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select timestamptz '2026-08-17 02:00:00+00' $$;

comment on function internal.duel_round_anchor() is
  'Start of a known duel round. Rounds are four game weeks back to back from '
  'here; see 0184.';

-- One round. Returns how many rows were written or corrected.
create function internal.derive_duel_round(p_round_start timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week constant interval := interval '7 days';
  -- The duel ends on the game's Saturday, which closes at Sunday 02:00 UTC.
  v_frozen constant interval := interval '6 days';
  -- The loops' own m and k exist only inside them (plpgsql), so the week the
  -- inner loop settled on is carried out in this.
  v_found_k int;
  v_ws_m timestamptz;
  v_ws_k timestamptz;
  v_round_at timestamptz;
  v_weekly_at timestamptz;
  v_others int;
  v_written int := 0;
  v_n int;
begin
  if p_round_start is null then
    return 0;
  end if;

  for v_m in 0..3 loop
    v_ws_m := p_round_start + v_m * v_week;
    exit when v_ws_m > now();

    -- Captured (or hand-derived before this existed): not missing.
    continue when exists (
      select 1 from public.alliance_contribution_snapshots s
       where s.contribution_type = 'alliance_battle_weekly'
         and s.captured_at > v_ws_m
         and s.captured_at <= v_ws_m + v_week
         and s.source_command not in ('manual.contribution', 'derived:round-total')
    );

    v_round_at := null;
    v_weekly_at := null;
    for v_k in v_m..3 loop
      v_ws_k := p_round_start + v_k * v_week;
      exit when v_ws_k > now();

      if v_k = v_m then
        select max(s.captured_at) into v_round_at
          from public.alliance_contribution_snapshots s
         where s.contribution_type = 'alliance_battle_round'
           and s.source_command = 'al.battle.rank.info'
           and s.captured_at >= v_ws_k + v_frozen
           and s.captured_at <= v_ws_k + v_week;
      else
        select r.t, w.t into v_round_at, v_weekly_at
          from (
            select distinct s.captured_at as t
              from public.alliance_contribution_snapshots s
             where s.contribution_type = 'alliance_battle_round'
               and s.source_command = 'al.battle.rank.info'
               and s.captured_at > v_ws_k and s.captured_at <= v_ws_k + v_week
          ) r
          join (
            select distinct s.captured_at as t
              from public.alliance_contribution_snapshots s
             where s.contribution_type = 'alliance_battle_weekly'
               and s.source_command = 'al.battle.rank.info'
               and s.captured_at > v_ws_k and s.captured_at <= v_ws_k + v_week
          ) w on abs(extract(epoch from r.t - w.t)) <= 120
         order by (least(r.t, w.t) >= v_ws_k + v_frozen) desc,
                  abs(extract(epoch from r.t - w.t)),
                  r.t desc
         limit 1;
      end if;

      v_found_k := v_k;
      exit when v_round_at is not null;
    end loop;

    continue when v_round_at is null;

    -- Weeks before k other than M, each of which must supply a final reading.
    v_others := v_found_k - case when v_found_k > v_m then 1 else 0 end;

    create temporary table if not exists pg_temp.derived_week (
      snapshot_id uuid, game_uid bigint, score bigint, raw jsonb
    ) on commit drop;
    truncate pg_temp.derived_week;

    insert into pg_temp.derived_week
    select
      r.snapshot_id,
      r.game_uid,
      r.score - coalesce(w.score, 0) - f.total,
      jsonb_build_object(
        'derived', true,
        'method', 'round total minus the other weeks of the round',
        'round_start', p_round_start,
        'round_total', r.score,
        'round_at', r.captured_at,
        'weekly_at', v_weekly_at,
        'same_week', w.score,
        'other_weeks', f.parts)
    from public.alliance_contribution_snapshots r
    left join public.alliance_contribution_snapshots w
      on v_weekly_at is not null
     and w.captured_at = v_weekly_at
     and w.contribution_type = 'alliance_battle_weekly'
     and w.source_command = 'al.battle.rank.info'
     and w.game_uid = r.game_uid
    cross join lateral (
      select count(*)::int as n,
             coalesce(sum(fs.score), 0) as total,
             coalesce(jsonb_object_agg((p_round_start + j * v_week)::text, fs.score), '{}') as parts
        from generate_series(0, v_found_k - 1) as j
        cross join lateral (
          select s.score
            from public.alliance_contribution_snapshots s
           where s.game_uid = r.game_uid
             and s.contribution_type = 'alliance_battle_weekly'
             and s.source_command not in ('manual.contribution', 'derived:round-total')
             and s.captured_at >= p_round_start + j * v_week + v_frozen
             and s.captured_at <= p_round_start + (j + 1) * v_week
             and s.score is not null
           order by s.captured_at desc
           limit 1
        ) fs
       where j <> v_m
    ) f
    where r.captured_at = v_round_at
      and r.contribution_type = 'alliance_battle_round'
      and r.source_command = 'al.battle.rank.info'
      and r.score is not null
      and (v_weekly_at is null or w.score is not null)
      and f.n = v_others;

    -- One negative figure means the round is not what this assumes. Writing
    -- the rest would put confident numbers on a wrong premise.
    if exists (select 1 from pg_temp.derived_week where score < 0) then
      raise warning 'duel week % not derived: round-minus-weeks is negative for % member(s)',
        v_ws_m, (select count(*) from pg_temp.derived_week where score < 0);
      continue;
    end if;

    insert into public.alliance_contribution_snapshots as t
      (observation_id, source_command, parser_version, idempotency_key, captured_at,
       collector_id, collected_from_server_id, raw,
       server_id, player_id, game_uid, alliance_name, alliance_code,
       contribution_type, score)
    select
      -- One observation per week and pairing, so the rows written together
      -- say they were written together.
      md5('derived:duel-week:' || extract(epoch from v_ws_m)::bigint
          || ':' || extract(epoch from v_round_at))::uuid,
      'derived:round-total', 'derived-2',
      'derived:duel-week:' || d.game_uid || ':' || extract(epoch from v_ws_m)::bigint,
      v_ws_m + interval '30 seconds',
      r.collector_id, r.collected_from_server_id, d.raw,
      r.server_id, r.player_id, r.game_uid, r.alliance_name, r.alliance_code,
      'alliance_battle_weekly', d.score
    from pg_temp.derived_week d
    join public.alliance_contribution_snapshots r on r.snapshot_id = d.snapshot_id
    on conflict (idempotency_key) do update
      set score = excluded.score,
          raw = excluded.raw,
          observation_id = excluded.observation_id
      where t.score is distinct from excluded.score;

    get diagnostics v_n = row_count;
    v_written := v_written + v_n;
  end loop;

  return v_written;
end;
$$;

comment on function internal.derive_duel_round(timestamptz) is
  'Fills each weekly duel board of one round that was never captured, as the '
  'round total minus the round''s other weeks. Idempotent; see 0184.';

revoke execute on function internal.derive_duel_round(timestamptz) from public, anon, authenticated;

-- Every round since the anchor that has started.
create function internal.derive_missing_duel_weeks()
returns int
language sql
security definer
set search_path = ''
as $$
  select coalesce(sum(internal.derive_duel_round(r)), 0)::int
    from generate_series(internal.duel_round_anchor(), now(), interval '28 days') as r;
$$;

comment on function internal.derive_missing_duel_weeks() is
  'Runs derive_duel_round for every round since duel_round_anchor. Hourly.';

revoke execute on function internal.derive_missing_duel_weeks() from public, anon, authenticated;

-- Hourly. The boards are opened by hand, a few times a week at most; an hour
-- is nothing against a figure nobody needs before the fortnight is built.
select cron.schedule(
  'duel-derive-missing-weeks',
  '17 * * * *',
  $$ select internal.derive_missing_duel_weeks(); $$);

-- The daily chart leaves derived rows out for the same reason as typed ones:
-- stamped just after Monday's reset, a whole week's figure would read as
-- Monday's. Otherwise identical to 0176.
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
   and s.source_command not like 'derived:%'
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

-- Now, rather than at the next :17 — 2026-09-14 is waiting.
select internal.derive_missing_duel_weeks();
