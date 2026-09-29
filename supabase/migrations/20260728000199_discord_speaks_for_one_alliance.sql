-- 0199: each alliance's Discord hears about that alliance.
--
-- Until now notifications were per install: one set of channels (webhooks),
-- one routing blob in app_settings ({event: {enabled, channel}}), and every
-- producer — the minute cron (0130/0131), announce_rank_period, dw-notify —
-- read that one blob. With two own alliances that posts ACE's notices,
-- schedule reminders, claims and sign-ups into CBFW's rooms.
--
-- THE SHAPE, chosen to move as little as possible:
--
--   * notification_channels gains alliance_id. Channel NAMES stay unique
--     across the install, so the outbox and every deliverer (0130's pg_net
--     sender, dw-notify) keep looking a webhook up by name and do not change.
--     Existing channels are the primary's. A restrictive policy means an
--     admin manages the channels of the alliance on screen.
--   * Routing becomes per alliance. The primary's stays in app_settings — so
--     every reader that does not know about alliances still reads the
--     primary's — and any other alliance's lives in alliance_settings under
--     'discord_notifications'. It is NOT inherited: an alliance with no
--     routing of its own sends nothing, rather than into the primary's rooms.
--   * Each producer routes by the alliance its source row belongs to:
--     player claims and schedule reminders by their alliance_id, sign-ups by
--     the alliance the account asked for (0193), the rank-period
--     announcement by the alliance being viewed. Collector health
--     (sync_stalled) is about the machine, not an alliance, and stays on the
--     primary's routing.
--   * A post may only name channels of its own alliance.

-- ---------------------------------------------------------------------------
-- Channels belong to an alliance.

alter table public.notification_channels
  add column alliance_id uuid references public.alliances (alliance_id) on delete cascade
    default public.active_alliance();

create index notification_channels_alliance_idx on public.notification_channels (alliance_id);

comment on column public.notification_channels.alliance_id is
  'The alliance whose Discord this webhook posts into (0199). Null means the '
  'primary. Names stay unique across the install, so a lookup by name is '
  'still a lookup of exactly one webhook.';

create policy alliance_scope on public.notification_channels as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

-- ---------------------------------------------------------------------------
-- Routing per alliance.

alter table public.alliance_settings drop constraint alliance_settings_known_key;
alter table public.alliance_settings add constraint alliance_settings_known_key
  -- The same list is in save_alliance_setting() and freeze_alliance_settings().
  check (key in ('rank_tiers', 'discord_notifications'));

create function internal.alert_channel(p_event text, p_alliance uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- The primary's routing is app_settings; anybody else's is theirs alone,
  -- with no fallback to the primary's — see the header.
  select case
    when coalesce((r.value -> p_event ->> 'enabled')::boolean, false)
      then nullif(r.value -> p_event ->> 'channel', '')
  end
  from (
    select case
      when coalesce(p_alliance, public.primary_own_alliance())
           is not distinct from public.primary_own_alliance()
        then (select s.value from public.app_settings s
               where s.key = 'discord_notifications')
      else (select o.value from public.alliance_settings o
             where o.alliance_id = p_alliance and o.key = 'discord_notifications')
    end as value
  ) r
$$;

revoke execute on function internal.alert_channel(text, uuid) from public, anon, authenticated;

comment on function internal.alert_channel(text, uuid) is
  'The channel one alliance''s routing sends an event to, or null when that '
  'alliance has it off. The one-argument form (0131) is the primary''s, and is '
  'what collector-health alarms keep using.';

-- ---------------------------------------------------------------------------
-- The names an editor may pick: the alliance on screen's. 0127's body and
-- gate, plus the alliance filter; dw-notify (service) still sees them all.

create or replace view public.notification_channel_names
with (security_invoker = false) as
select
  channel,
  enabled
from public.notification_channels
where (
    public.has_permission('schedule.manage')
    or public.has_permission('announcement.write')
    or public.has_permission('guide.write')
    or public.current_app_role() = 'admin'
  )
  and coalesce(alliance_id, public.primary_own_alliance())
      is not distinct from public.active_alliance()
  or public.is_service_request();

grant select on public.notification_channel_names to authenticated;

-- The settings writer accepts the new per-alliance key.

create or replace function public.save_alliance_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if not public.has_permission('settings.write') then
    raise exception 'changing settings requires settings.write' using errcode = '42501';
  end if;
  if p_key not in ('rank_tiers', 'discord_notifications') then
    raise exception 'not a per-alliance setting' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'a setting needs a value' using errcode = '22023';
  end if;

  -- The primary alliance's value IS app_settings: every reader not yet
  -- alliance-aware reads it there, and must keep seeing the primary's.
  if v_alliance is null or v_alliance = public.primary_own_alliance() then
    insert into public.app_settings (key, value, updated_by)
    values (p_key, p_value, (select auth.uid()))
    on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  else
    insert into public.alliance_settings (alliance_id, key, value, updated_by)
    values (v_alliance, p_key, p_value, (select auth.uid()))
    on conflict (alliance_id, key) do update
      set value = excluded.value, updated_by = excluded.updated_by;
  end if;
end;
$$;

-- A pin change: Discord starts empty for a new alliance; a demoted primary
-- keeps its routing; a promoted one's routing moves into the shared row.

drop function public.freeze_alliance_settings();

create function public.freeze_alliance_settings(p_old_primary uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary uuid := public.primary_own_alliance();
begin
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, s.key, s.value, s.updated_by
  from public.alliances a
  cross join public.app_settings s
  where a.is_own
    and a.alliance_id is distinct from v_primary
    -- The per-alliance keys: the same list alliance_settings_known_key and
    -- save_alliance_setting carry (0195).
    and s.key in ('rank_tiers')
  on conflict (alliance_id, key) do nothing;

  -- DISCORD IS NOT COPIED to a newly pinned alliance. Its routing names
  -- channels, and the primary's channels are the primary's Discord: a copy
  -- would post the new alliance's notices into the other alliance's rooms.
  -- It starts empty (everything off) until its officers choose. The one
  -- exception is the alliance that WAS primary a moment ago: its routing is
  -- the shared row, and it keeps it.
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, 'discord_notifications',
         case when a.alliance_id = p_old_primary
              then coalesce((select s.value from public.app_settings s
                              where s.key = 'discord_notifications'), '{}'::jsonb)
              else '{}'::jsonb end,
         null
  from public.alliances a
  where a.is_own
    and a.alliance_id is distinct from v_primary
  on conflict (alliance_id, key) do nothing;

  -- A NEW primary that was never pinned before has no routing of its own,
  -- and the shared row still holds the OLD primary's rooms (copied to it just
  -- above). It starts empty, like any newly pinned alliance.
  if p_old_primary is not null
     and v_primary is distinct from p_old_primary
     and not exists (select 1 from public.alliance_settings o
                      where o.alliance_id = v_primary
                        and o.key = 'discord_notifications') then
    update public.app_settings set value = '{}'::jsonb
     where key = 'discord_notifications';
  end if;

  -- THEN the new primary's own values move into the shared row, and its
  -- override goes. Without this a promoted alliance would keep reading its
  -- override (alliance_setting prefers it) while its officers' edits land in
  -- app_settings (save_alliance_setting writes the primary's there) — every
  -- edit accepted and none of them taking effect. Second, so the copies
  -- above were taken from the OLD primary's values.
  -- An upsert, not an update: with no shared row yet, an update would do
  -- nothing and the delete below would throw the values away.
  insert into public.app_settings (key, value, updated_by)
  select o.key, o.value, o.updated_by
  from public.alliance_settings o
  where o.alliance_id = v_primary
    and o.key in ('rank_tiers', 'discord_notifications')
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by;
  delete from public.alliance_settings
   where alliance_id = v_primary
     and key in ('rank_tiers', 'discord_notifications');
end;
$$;

revoke all on function public.freeze_alliance_settings(uuid) from public, anon, authenticated;

create or replace function public.app_settings_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.key, old.key) = 'own_alliance' then
    perform public.resolve_own_alliance();
    -- Which alliance was primary before this write, from the OLD pin, so the
    -- freeze can tell a demoted primary from a newly pinned alliance.
    perform public.freeze_alliance_settings(
      case when tg_op in ('UPDATE', 'DELETE') then
        coalesce((old.value -> 'alliance_ids' ->> 0)::uuid,
                 (old.value ->> 'alliance_id')::uuid)
      end);
  end if;
  return null;
end;
$$;

-- The rank-period announcement, into the announcing alliance's channel.

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
  v_alliance uuid := public.active_alliance();
begin
  -- Same gate as build_rank_period (0112). An announcement over the
  -- collector's name into the alliance channel is officer business.
  if public.current_app_role() not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  -- The alliance being viewed announces into ITS channel (0199).
  v_channel := internal.alert_channel('rank_period', v_alliance);
  if v_channel is null then
    return 'The rank period announcement is switched off, or has no channel. '
      || 'Turn it on under Notifications.';
  end if;

  select m.period_start into v_period
  from (select x.* from public.rank_period_movement x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) m limit 1;
  if v_period is null then
    return 'No finished period to announce yet.';
  end if;

  select max(scoring_version) into v_version
  from public.rank_period_snapshots where period_start = v_period
    and coalesce(alliance_id, public.primary_own_alliance()) is not distinct from v_alliance;

  -- Once per period per scoring version, as the settings screen has always
  -- promised. A rebuild under the same version does not re-announce; a rebuild
  -- under a NEW version is a different answer and may.
  v_key := 'rank_period:' || to_char(v_period at time zone 'UTC', 'YYYY-MM-DD')
    || ':v' || v_version
    -- The primary keeps the key it always had, so nothing already sent is
    -- sent again; any other alliance's period is its own announcement.
    || case when v_alliance is distinct from public.primary_own_alliance()
            then ':' || v_alliance::text else '' end;
  if exists (select 1 from public.notification_outbox where idempotency_key = v_key) then
    return 'Already sent for this period under scoring version ' || v_version || '.';
  end if;

  select string_agg(tier || ' ' || n, '  ·  ' order by tier desc)
    into v_counts
  from (
    select tier, count(*) as n from (select x.* from public.rank_period_latest x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_latest
    where period_start = v_period and tier is not null
    group by tier
  ) t;

  -- Whether there is a predecessor at all. `tier_change` is null for everyone
  -- when there is not, which is indistinguishable from nobody having moved.
  select bool_or(previous_period_start is not null) into v_comparable
  from (select x.* from public.rank_period_movement x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_movement;

  select string_agg(coalesce(name, 'a member') || ' → ' || tier, ', ' order by name)
    into v_promoted
  from (select x.* from public.rank_period_movement x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_movement where tier_change > 0;

  select string_agg(coalesce(name, 'a member') || ' → ' || tier, ', ' order by name)
    into v_demoted
  from (select x.* from public.rank_period_movement x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_movement where tier_change < 0;

  select string_agg(line, chr(10)) into v_gainers from (
    select '· ' || coalesce(name, 'a member') || '  +' || round(score_change, 1) as line
    from (select x.* from public.rank_period_movement x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_movement
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
    from (select x.* from public.rank_period_latest x where x.player_id in (
          select s.player_id from public.rank_period_snapshots s
           where coalesce(s.alliance_id, public.primary_own_alliance()) is not distinct from v_alliance)) rank_period_latest
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

-- ---------------------------------------------------------------------------
-- The minute cron's detectors (0131), each routing by its row's alliance.
-- Bodies are 0131's; what changed is that the channel is looked up per row
-- instead of once, and a row whose alliance has the event off is skipped
-- rather than the whole detector returning early.

create or replace function internal.detect_player_claims()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int := 0;
begin
  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    ch.channel,
    'player_claim',
    'player_claim:' || c.user_id || ':' || coalesce(p.game_uid::text, 'null') || ':' ||
      to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00'),
    'Player link requested',
    '**' || coalesce(u.display_name, 'member ' || left(c.user_id::text, 8)) ||
      '** is asking to be linked to **' ||
      coalesce(p.current_name, 'UID ' || p.game_uid::text, 'an unnamed player') || '**.'
      || chr(10) || chr(10)
      || 'Filed: ' || to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
  from public.player_claims c
  cross join lateral (
    select internal.alert_channel('player_claim', c.alliance_id) as channel
  ) ch
  left join public.players p on p.player_id = c.player_id
  left join public.app_users u on u.user_id = c.user_id
  where c.status = 'pending'
    and ch.channel is not null
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

create or replace function internal.detect_new_signups()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int := 0;
begin
  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    ch.channel,
    'new_signup',
    'new_signup:' || a.id,
    'Someone is waiting for access',
    'Somebody signed in and has no access yet (`' || left(a.id::text, 8) || '`).'
      || chr(10) || chr(10)
      || coalesce('Signed up: '
           || to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z',
         'Sign-up date unknown.')
      || chr(10) || chr(10)
      || 'They need a join code before they can see anything.'
  from auth.users a
  -- The alliance they asked for (0193), if it is one of ours; the primary
  -- otherwise, which is where an account that asked nothing has always waited.
  -- The metadata is the user's own to write. The uuid cast sits inside the
  -- CASE branch the regex guards, so a malformed value reads as "asked for
  -- nothing" instead of aborting the minute cron (and sync_stalled with it).
  cross join lateral (
    select case
      when a.raw_user_meta_data ->> 'alliance_id'
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (select x.alliance_id from public.alliances x
               where x.alliance_id = (a.raw_user_meta_data ->> 'alliance_id')::uuid
                 and x.is_own)
    end as asked
  ) q
  cross join lateral (
    select internal.alert_channel('new_signup', q.asked) as channel
  ) ch
  left join public.app_users u on u.user_id = a.id
  where u.user_id is null
    and ch.channel is not null
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- The reminders view gains the event's alliance, appended so the view can be
-- replaced in place. 0124's body otherwise.
create or replace view public.schedule_reminders_due
with (security_invoker = true) as
select
  r.reminder_id,
  r.schedule_event_id,
  r.minutes_before,
  e.title,
  e.starts_at,
  e.category,
  c.label as category_label,
  c.channel,
  e.starts_at - make_interval(mins => r.minutes_before) as fire_at,
  e.alliance_id
from public.schedule_reminders r
join public.schedule_events e using (schedule_event_id)
left join public.schedule_categories c on c.category = e.category;

create or replace function internal.detect_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int := 0;
begin
  insert into public.notification_outbox (channel, event, idempotency_key, title, body)
  select
    -- The board's channel wins, as in 0131 - but only a channel of the EVENT'S
    -- alliance. Board keys are install-wide (0124), so a board can point at
    -- another alliance's webhook; that one is ignored for the fallback rather
    -- than posting this alliance's reminder into the other's room.
    coalesce(
      case when d.channel is not null and exists (
        select 1 from public.notification_channels n
         where n.channel = d.channel
           and coalesce(n.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(d.alliance_id, public.primary_own_alliance()))
      then d.channel end,
      ch.fallback),
    'schedule_reminder',
    'schedule_reminder:' || d.reminder_id || ':' ||
      to_char(d.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS+00:00'),
    d.title,
    case when d.category_label is not null
      then '_' || d.category_label || '_' || chr(10) || chr(10) else '' end
      || 'Starting '
      || case when d.minutes_before = 0 then 'now'
              else 'in ' || d.minutes_before || ' minutes' end
      || ' — ' || to_char(d.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
  from public.schedule_reminders_due d
  cross join lateral (
    select internal.alert_channel('schedule_reminder', d.alliance_id) as fallback
  ) ch
  where d.fire_at <= now()
    and d.fire_at > now() - interval '15 minutes'
    and ch.fallback is not null
  on conflict (idempotency_key) do nothing;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- ---------------------------------------------------------------------------
-- A post names channels of its own alliance only. 0133's body, with the
-- existence check narrowed to the post's alliance.

create or replace function public.normalize_post_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unknown text;
begin
  select array_agg(distinct name order by name)
    into new.channels
    from unnest(coalesce(new.channels, '{}'::text[])) as name
   where name is not null and name <> '';

  if new.channels = '{}'::text[] then
    new.channels := null;
  end if;

  if new.channels is not null then
    select name into unknown
      from unnest(new.channels) as name
     where not exists (
       select 1 from public.notification_channels c
        where c.channel = name
          and coalesce(c.alliance_id, public.primary_own_alliance())
              is not distinct from coalesce(new.alliance_id, public.primary_own_alliance())
     )
     limit 1;
    if unknown is not null then
      raise exception 'no such notification channel for this alliance: %', unknown
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end;
$$;

-- A board may name only its own alliance's channel.
create function public.schedule_category_channel_is_ours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel is not null and not exists (
    select 1 from public.notification_channels c
     where c.channel = new.channel
       and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(new.alliance_id, public.primary_own_alliance())
  ) then
    raise exception 'no such notification channel for this alliance: %', new.channel
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.schedule_category_channel_is_ours() from public, anon, authenticated;

create trigger channel_is_ours
  before insert or update of channel on public.schedule_categories
  for each row execute function public.schedule_category_channel_is_ours();

-- What is already written: posts and boards that name another alliance's
-- channel (possible since 0194 let a second alliance post) lose that name. A
-- post left with none falls back to its alliance's routing, as a post that
-- named none always did. Only rows that change are touched.
update public.announcements p
   set channels = nullif(array(
         select n from unnest(p.channels) as n
          where exists (
            select 1 from public.notification_channels c
             where c.channel = n
               and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(p.alliance_id, public.primary_own_alliance()))
       ), '{}'::text[])
 where p.channels is not null
   and exists (
     select 1 from unnest(p.channels) as n
      where not exists (
        select 1 from public.notification_channels c
         where c.channel = n
           and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(p.alliance_id, public.primary_own_alliance())));

update public.guides p
   set channels = nullif(array(
         select n from unnest(p.channels) as n
          where exists (
            select 1 from public.notification_channels c
             where c.channel = n
               and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(p.alliance_id, public.primary_own_alliance()))
       ), '{}'::text[])
 where p.channels is not null
   and exists (
     select 1 from unnest(p.channels) as n
      where not exists (
        select 1 from public.notification_channels c
         where c.channel = n
           and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(p.alliance_id, public.primary_own_alliance())));

update public.schedule_categories k
   set channel = null
 where k.channel is not null
   and not exists (
     select 1 from public.notification_channels c
      where c.channel = k.channel
        and coalesce(c.alliance_id, public.primary_own_alliance())
               is not distinct from coalesce(k.alliance_id, public.primary_own_alliance()));

-- ---------------------------------------------------------------------------
-- The alliances already pinned get their (empty) routing now, rather than on
-- the next pin change. No old primary: nobody is being demoted.

select public.freeze_alliance_settings(null);
