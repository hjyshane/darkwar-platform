-- 0291: when a Capital Clash starts and ends, read from the game.
--
-- 0289 judged absences by the battle's window and said nothing reads one from
-- the game, so a window had to be typed per event. Two commands carry it:
--   get.king.info             kingInfo.termEndTime = the next clash's START (it
--                             said 10-17 14:00:00 on 10-08, nine days ahead; two
--                             weeks per term), finishTime = the last battle's end.
--   push.kingdom.fight.finish finishTime as the battle ends.
-- normalize/capital_clash_times.py writes each as a fact: its kind (start or
-- finish) and the instant.
--
-- capital_clash_windows is now a VIEW over those facts. A day's window is its
-- latest start and the first finish after it within 12 hours; a day with a
-- start and no finish yet (the clash is on, or not fought) has no window and is
-- judged as in 0287. A row typed into capital_clash_window_overrides beats the
-- facts for its day: for an event the game reported wrongly, or a battle from
-- before the collector read these commands. 0289's seeded 10-17 row is kept
-- there; the facts agree with it to the second but the start's 4 seconds.

create table public.capital_clash_times (
  snapshot_id uuid primary key,
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  kind text not null check (kind in ('start', 'finish')),
  at timestamptz not null,
  -- The game day the instant falls in (turns over at 02:00 UTC).
  held_on date not null,
  -- Who holds the capital, as the payload says; set on finish facts.
  occupy_alliance_external_id text
);

create index capital_clash_times_day_idx on public.capital_clash_times (held_on, kind, at);

comment on table public.capital_clash_times is
  'Capital Clash start and finish instants (get.king.info, '
  'push.kingdom.fight.finish, 0291): one row per distinct fact, however many '
  'times it was seen.';

alter table public.capital_clash_times enable row level security;
-- revoke-then-grant: hosted default privileges give authenticated all (0207).
revoke all on public.capital_clash_times from anon, authenticated;
grant select on public.capital_clash_times to authenticated;
grant all on public.capital_clash_times to service_role;

create policy member_read on public.capital_clash_times
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- 0289's table keeps its rows under a name that says what it is now.
alter table public.capital_clash_windows rename to capital_clash_window_overrides;
comment on table public.capital_clash_window_overrides is
  'A Capital Clash window typed by hand (0289, 0291). Beats what the game '
  'reported for the same day.';

create view public.capital_clash_windows
with (security_invoker = true) as
select o.held_on, o.starts_at, o.ends_at, o.note
  from public.capital_clash_window_overrides o
union all
select s.held_on, s.starts_at, f.ends_at, 'read from the game'::text
  from (
    select distinct on (t.held_on) t.held_on, t.at as starts_at
      from public.capital_clash_times t
     where t.kind = 'start'
     order by t.held_on, t.captured_at desc
  ) s
  cross join lateral (
    select min(t.at) as ends_at
      from public.capital_clash_times t
     where t.kind = 'finish'
       and t.at > s.starts_at
       and t.at <= s.starts_at + interval '12 hours'
  ) f
 where f.ends_at is not null
   and not exists (select 1 from public.capital_clash_window_overrides o
                    where o.held_on = s.held_on);

comment on view public.capital_clash_windows is
  'When each Capital Clash was fought (0289, 0291): a typed override, else the '
  'latest start and the first finish after it from the game. A day without both '
  'has no row.';

revoke all on public.capital_clash_windows from anon, authenticated;
grant select on public.capital_clash_windows to authenticated;
grant all on public.capital_clash_windows to service_role;
