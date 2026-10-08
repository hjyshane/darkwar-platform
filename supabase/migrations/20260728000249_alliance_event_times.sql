-- 0249: the times the alliance chose for the siege, Frankie and Black Gold are
-- read from the game and land on the schedule board.
--
-- 0124 built the board for entries somebody types, and left `source` for the
-- day the game turned out to send a schedule: "a captured row can arrive later
-- without a second table". It does, for three events. Every logged-in member is
-- told the pick (normalize/alliance_event_times.py):
--
--   zombie_siege  monster.siege.activity.info             the siege's start
--   bio_mutant    get.alliance.boss.activity.info.new     Frankie, two battles a day
--   black_gold    dragon.activity.info                    team A (slot 1) and B (slot 2)
--
-- Checked against what the alliance set on 2026-10-08, in server time (UTC-2):
-- siege 11:30, Frankie 00:30 and 13:00, Black Gold B 10/11 10:00 and A 19:00.
--
--   * alliance_event_times: one row per distinct time the collector saw
--     (snapshot rows like every other capture, deduplicated by key).
--   * Which alliance? Black Gold's response names both sides and the parser
--     knows ours. The siege and Frankie responses name nobody; the alliance of
--     the account that was logged in is the only link, taken from that account's
--     login (account_state_snapshots, same collector, within ten minutes) and its
--     newest roster row. If that cannot be told the row is stored and no board
--     entry is made: a siege put on the wrong alliance's board is worse than a
--     missing one.
--   * internal.apply_alliance_event_time(): puts the row on the alliance's
--     schedule board as a `captured` entry, keyed by (event, slot, server day), so
--     a time the game changes later the same day edits the entry instead of
--     adding another, and an entry that only exists in the future is replaced
--     when the pick moves to another day. It updates WHEN, never the title, text or
--     board an officer changed, and it never adds a reminder: a reminder is a
--     Discord message (0124), and that stays a decision for schedule.manage.
--   * The boards it files under (Zombie Siege, Frankie, Black Gold) are created
--     per alliance with no Discord channel, so nothing is sent until an officer
--     routes one.
--
-- A failure inside the trigger is a warning, never an error: the snapshot must
-- not be lost over a board entry (RAISE EXCEPTION would roll the insert back).

alter table public.schedule_events add column source_key text;

create unique index schedule_events_source_key_idx
  on public.schedule_events (alliance_id, source_key)
  where source_key is not null;

comment on column public.schedule_events.source_key is
  'Identity of a captured entry within its alliance (0249): event, slot and '
  'server day. Null for entries somebody typed.';

create table public.alliance_event_times (
  snapshot_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  event_key text not null check (event_key in ('zombie_siege', 'bio_mutant', 'black_gold')),
  -- Black Gold: the team (1 = A, 2 = B). Frankie: the battle of the day (1, 2).
  slot int not null check (slot > 0),
  alliance_id uuid references public.alliances (alliance_id),
  alliance_external_id text,
  prep_at timestamptz,
  starts_at timestamptz not null,
  ends_at timestamptz,
  check (ends_at is null or ends_at > starts_at)
);

create index alliance_event_times_event_idx
  on public.alliance_event_times (alliance_id, event_key, slot, starts_at desc);

alter table public.alliance_event_times enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207).
revoke all on public.alliance_event_times from anon, authenticated;
grant select on public.alliance_event_times to authenticated;
grant all on public.alliance_event_times to service_role;

create policy member_read on public.alliance_event_times
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.alliance_event_times is
  'When the alliance set its Zombie Siege, Frankie and Black Gold battles, as the '
  'game reported it (0249). Written by the collector; internal.apply_alliance_event_time() '
  'puts each row on the schedule board.';

-- ------------------------------------------------------------ which alliance

create function internal.event_time_alliance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.alliance_id is not null then
    return new;
  end if;
  -- The account that logged in just before this response came back.
  select m.alliance_id into new.alliance_id
    from public.account_state_snapshots a
    join public.alliance_member_snapshots m on m.player_id = a.player_id
   where a.collector_id = new.collector_id
     and a.player_id is not null
     and a.captured_at <= new.captured_at
     and a.captured_at > new.captured_at - interval '10 minutes'
   order by a.captured_at desc, m.captured_at desc
   limit 1;
  return new;
end;
$$;

revoke all on function internal.event_time_alliance() from public, anon, authenticated;

create trigger alliance_event_times_resolve
  before insert on public.alliance_event_times
  for each row execute function internal.event_time_alliance();

-- ------------------------------------------------------------ the board entry

create function internal.apply_alliance_event_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text := 'game_' || new.event_key;
  v_key text;
  v_title text;
  v_label text;
begin
  -- A time long past is history the board does not need, and a row with no
  -- alliance has no board to go on.
  if new.alliance_id is null or new.starts_at < now() - interval '14 days' then
    return new;
  end if;

  v_label := case new.event_key
    when 'zombie_siege' then 'Zombie Siege'
    when 'bio_mutant' then 'Frankie'
    else 'Black Gold'
  end;
  v_title := case new.event_key
    when 'zombie_siege' then 'Zombie Siege'
    when 'bio_mutant' then 'Frankie ' || new.slot
    else 'Black Gold, team ' || case new.slot when 1 then 'A' when 2 then 'B' else new.slot::text end
  end;
  -- Server time is UTC-2, and the game's day turns over there.
  v_key := new.event_key || ':' || new.slot || ':'
           || to_char((new.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD');

  -- Snapshots can arrive out of order after an outage: the newest reading of
  -- this event, slot and server day is the one the entry shows.
  if exists (
    select 1 from public.alliance_event_times t
     where t.alliance_id = new.alliance_id
       and t.event_key = new.event_key
       and t.slot = new.slot
       and t.snapshot_id <> new.snapshot_id
       and to_char((t.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD')
           = to_char((new.starts_at - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD')
       and t.captured_at > new.captured_at
  ) then
    return new;
  end if;

  insert into public.schedule_categories (alliance_id, category, label, sort_order)
  values (new.alliance_id, v_category, v_label, 100)
  on conflict (alliance_id, category) do nothing;

  -- The pick moved to another day while the old one was still ahead: the old
  -- entry is no longer true.
  delete from public.schedule_events e
   where e.alliance_id = new.alliance_id
     and e.source = 'captured'
     and e.source_key like new.event_key || ':' || new.slot || ':%'
     and e.source_key <> v_key
     and e.starts_at > now();

  insert into public.schedule_events
    (alliance_id, title, body, category, starts_at, ends_at, source, source_key)
  values (
    new.alliance_id, v_title, 'Read from the game.', v_category,
    new.starts_at, new.ends_at, 'captured', v_key)
  on conflict (alliance_id, source_key) where source_key is not null do update
    set starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        updated_at = now();
  return new;
exception when others then
  raise warning 'apply_alliance_event_time: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;

revoke all on function internal.apply_alliance_event_time() from public, anon, authenticated;

create trigger alliance_event_times_apply
  after insert on public.alliance_event_times
  for each row execute function internal.apply_alliance_event_time();
