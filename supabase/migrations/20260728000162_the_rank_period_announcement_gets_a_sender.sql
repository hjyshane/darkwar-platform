-- 0162: the rank_period announcement finally has something that sends it.
--
-- `rank_period` has been in the notification routing since 0076 and described
-- on the settings screen ever since — "Tier counts, why anybody is ungraded,
-- and who changed rank. Once per period per scoring version." Nothing has ever
-- inserted it. An admin could switch it on, pick a channel, and wait forever.
-- This is the same failure CLAUDE.md records against `al.battle.rank.info`:
-- something declared, described, and never wired.
--
-- BY HAND, NOT ON A SCHEDULE. There is no scheduler behind the rank report and
-- this does not add one. The period is built when an officer presses Build, and
-- it is announced when an officer presses Send — which is the right shape for a
-- message that names people who were demoted. Nobody should learn they dropped
-- a tier because a cron job decided the fortnight was over.
--
-- IT ANNOUNCES THE NEWEST FINISHED PERIOD, whatever the screen is showing,
-- because that is what `rank_period_movement` describes and 0100 exists to keep
-- the predecessor logic in ONE place. Composing an announcement for an
-- arbitrary period would mean working out "the previous period of the same
-- scoring version" a second time, and two copies of that rule is how they drift
-- apart. If the screen is showing something else, the function says so and
-- sends nothing.
--
-- MOVEMENT NEEDS TWO PERIODS OF ONE VERSION. The view compares within a
-- scoring version (0088), so straight after a version bump there is nothing to
-- compare against and the promoted/demoted lists are legitimately empty. The
-- message says that in words rather than printing two empty headings, because
-- "nobody moved" and "we cannot tell yet" are different facts and only one of
-- them is good news.

create or replace function public.announce_rank_period()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_period timestamptz;
  v_version int;
  v_key text;
  v_counts text;
  v_promoted text;
  v_demoted text;
  v_gainers text;
  v_ungraded text;
  v_comparable boolean;
  v_body text;
begin
  -- Same gate as build_rank_period (0112). An announcement over the
  -- collector's name into the alliance channel is officer business.
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  v_channel := internal.alert_channel('rank_period');
  if v_channel is null then
    return 'The rank period announcement is switched off, or has no channel. '
      || 'Turn it on under Notifications.';
  end if;

  select m.period_start into v_period
  from public.rank_period_movement m limit 1;
  if v_period is null then
    return 'No finished period to announce yet.';
  end if;

  select max(scoring_version) into v_version
  from public.rank_period_snapshots where period_start = v_period;

  -- Once per period per scoring version, as the settings screen has always
  -- promised. A rebuild under the same version does not re-announce; a rebuild
  -- under a NEW version is a different answer and may.
  v_key := 'rank_period:' || to_char(v_period at time zone 'UTC', 'YYYY-MM-DD')
    || ':v' || v_version;
  if exists (select 1 from public.notification_outbox where idempotency_key = v_key) then
    return 'Already sent for this period under scoring version ' || v_version || '.';
  end if;

  select string_agg(tier || ' ' || n, '  ·  ' order by tier desc)
    into v_counts
  from (
    select tier, count(*) as n from public.rank_period_latest
    where period_start = v_period and tier is not null
    group by tier
  ) t;

  -- Whether there is a predecessor at all. `tier_change` is null for everyone
  -- when there is not, which is indistinguishable from nobody having moved.
  select bool_or(previous_period_start is not null) into v_comparable
  from public.rank_period_movement;

  select string_agg(coalesce(name, 'a member') || ' → ' || tier, ', ' order by name)
    into v_promoted
  from public.rank_period_movement where tier_change > 0;

  select string_agg(coalesce(name, 'a member') || ' → ' || tier, ', ' order by name)
    into v_demoted
  from public.rank_period_movement where tier_change < 0;

  select string_agg(line, chr(10)) into v_gainers from (
    select '· ' || coalesce(name, 'a member') || '  +' || round(score_change, 1) as line
    from public.rank_period_movement
    where score_change > 0
    order by score_change desc
    limit 3
  ) g;

  -- The blanks are not failures and the screen already explains them; the
  -- announcement should not leave the alliance wondering why the numbers do not
  -- add up to the roster.
  select string_agg(label || ' ' || n, ', ' order by label) into v_ungraded from (
    select case
             when tier_reason like 'measured but not ranked%' then 'officers'
             when tier_reason like 'not measured%' then 'too new'
             when tier_reason like 'nothing was captured%' then 'never seen'
           end as label,
           count(*) as n
    from public.rank_period_latest
    where period_start = v_period and tier is null
    group by 1
  ) u where label is not null;

  v_body :=
    coalesce('**Tiers** ' || v_counts, '**Tiers** none')
    || case when v_ungraded is null then '' else
         chr(10) || 'Ungraded: ' || v_ungraded end
    || chr(10) || chr(10)
    || case
         when not coalesce(v_comparable, false) then
           '_First period scored under version ' || v_version
           || ', so there is nothing to compare it against yet. Movement will '
           || 'appear from the next fortnight._'
         else
           coalesce('**Up** ' || v_promoted, '**Up** nobody')
           || chr(10) || coalesce('**Down** ' || v_demoted, '**Down** nobody')
           || case when v_gainers is null then '' else
                chr(10) || chr(10) || '**Biggest gains**' || chr(10) || v_gainers end
       end;

  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  values (
    v_channel,
    'rank_period',
    v_key,
    'Rank period ' || to_char(v_period at time zone 'UTC', 'YYYY-MM-DD')
      || ' — ' || to_char((v_period + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD'),
    v_body);

  return 'Queued for #' || v_channel || '. It posts on the collector''s next pass.';
end;
$$;

comment on function public.announce_rank_period() is
  'Queues the rank_period announcement for the newest FINISHED period: tier '
  'counts, who is ungraded and why, and who moved. Officer and up. Once per '
  'period per scoring version, enforced by idempotency_key. Announces the '
  'period rank_period_movement describes, never an arbitrary one, so the '
  '"previous period of the same version" rule stays in one place (0100).';

revoke execute on function public.announce_rank_period() from public, anon;
grant execute on function public.announce_rank_period() to authenticated;
