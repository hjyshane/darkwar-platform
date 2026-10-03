-- The server's event calendar, from the login response, and names for it.
--
-- `init.activity` lists every event the server has scheduled — running now
-- and a few weeks ahead — with an id, start and end in epoch ms, the HQ level
-- it needs, and timing extras (normalize/event_schedule.py strips the
-- per-account fields first). It is the same for everyone on a server, so it
-- is readable by every member, unlike the account state in the same login.
--
-- The game sends no names: `id` is all there is. event_names is where people
-- put them, one row per id, editable by officers and admins from the
-- dashboard; an unnamed event shows by its id until someone names it.
--
-- One snapshot row per distinct calendar (the key hashes the cleaned list),
-- folded as jsonb. Daily events roll every day and accounts see slightly
-- different lists, so most logins on different days are new rows (62 logins
-- made 50) — small rows, so that is fine. event_schedule_current unrolls the newest one per server into
-- one row per event — about 70, far under PostgREST's 1,000-row cap.

create table public.event_schedule_snapshots (
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

  server_id int not null references public.servers (server_id),
  events jsonb not null default '[]'::jsonb
);

create index event_schedule_server_captured_idx
  on public.event_schedule_snapshots (server_id, captured_at desc);

alter table public.event_schedule_snapshots enable row level security;

-- revoke-then-grant, not a bare grant: the hosted project's default
-- privileges hand authenticated everything, TRUNCATE included (0207).
revoke all on public.event_schedule_snapshots from anon, authenticated;
grant select on public.event_schedule_snapshots to authenticated;
grant all on public.event_schedule_snapshots to service_role;

create policy member_read on public.event_schedule_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create table public.event_names (
  activity_id text primary key check (activity_id ~ '^[0-9]+$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  note text check (note is null or length(note) <= 500),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create trigger event_names_set_updated_at
  before update on public.event_names
  for each row execute function public.set_updated_at();

alter table public.event_names enable row level security;

revoke all on public.event_names from anon, authenticated;
grant select, insert, update, delete on public.event_names to authenticated;
grant all on public.event_names to service_role;

create policy member_read on public.event_names
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

create policy officer_insert on public.event_names
  for insert to authenticated
  with check ((select public.current_app_role()) in ('officer', 'admin'));

create policy officer_update on public.event_names
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));

create policy officer_delete on public.event_names
  for delete to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));

-- Epoch ms → timestamptz, or null for the 0 / missing the game uses for
-- "no time". Far-future ends (year 2044 and beyond) mark permanent events
-- and are kept as they are; the screen decides how to show them.
create function public.epoch_ms_to_timestamptz(p_ms jsonb)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_ms) = 'number' and (p_ms)::numeric > 0
      then to_timestamp((p_ms)::numeric / 1000)
  end
$$;

revoke all on function public.epoch_ms_to_timestamptz(jsonb) from public, anon;
grant execute on function public.epoch_ms_to_timestamptz(jsonb) to authenticated, service_role;

create view public.event_schedule_current
with (security_invoker = true) as
with latest as (
  select distinct on (s.server_id) s.server_id, s.captured_at, s.events
  from public.event_schedule_snapshots s
  order by s.server_id, s.captured_at desc
)
select
  l.server_id,
  e ->> 'id' as activity_id,
  n.name,
  public.epoch_ms_to_timestamptz(e -> 'startTime') as starts_at,
  public.epoch_ms_to_timestamptz(e -> 'endTime') as ends_at,
  (e ->> 'needMainCityLevel')::int as need_hq_level,
  (e ->> 'subType')::int as sub_type,
  e - array['id', 'startTime', 'endTime', 'needMainCityLevel', 'subType'] as detail,
  l.captured_at as seen_at
from latest l
cross join lateral jsonb_array_elements(l.events) as e
left join public.event_names n on n.activity_id = e ->> 'id';

revoke all on public.event_schedule_current from anon, authenticated;
grant select on public.event_schedule_current to authenticated;
grant select on public.event_schedule_current to service_role;
