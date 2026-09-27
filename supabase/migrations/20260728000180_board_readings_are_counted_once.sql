-- 0180: a board reading's size and server span are counted when it is
-- written, not every time a chart is drawn.
--
-- `alliance_power_history` needs two facts about each READING an alliance
-- appears in: how many alliances the board held (`board_size`) and whether it
-- spanned servers (`board_scope`, 0081). 0153 computed both with a lateral
-- over the reading's rows — correct, and index-driven, but it reads EVERY row
-- of every board the alliance was ever on.
--
-- Measured on production 2026-09-27, as a member, after 0179 had already made
-- the role check a one-off InitPlan:
--
--   Execution Time: 3401 ms
--   the alliance's own readings      1,071 rows      0.24 s    896 pages read
--   the per-reading board count      loops=1071    ~3.15 s  9,859 pages read
--
-- 1,071 boards x ~78 rows = ~83,000 heap rows scattered across the table, on
-- an instance whose cache cannot hold it. No longer the role check — the
-- reading itself — and it grows with every capture.
--
-- A reading is immutable once its rows have landed, so the two facts are
-- stored once per reading, keyed by observation_id, and the view reads one
-- row per reading by primary key. The trends chart goes from ~83,000 heap
-- rows to 1,071 index probes on a table of a few thousand rows.
--
-- WHY RECOUNT RATHER THAN INCREMENT. Sync delivers in batches of 100 and a
-- board carries up to ~200 rows, so one reading can arrive in two or more
-- statements. The trigger therefore recounts each touched observation from
-- `alliance_snapshots` itself rather than adding the batch's rows to a stored
-- total: a replay, a partial batch or a batch that lands twice all come out
-- right, because the answer is always "what the table holds now". The
-- recount is an index descent over one reading's rows (0128's observation
-- index), per touched reading, per statement.
--
-- The trigger is an invoker function, like 0128's. The collector writes as
-- service_role, which bypasses RLS, so the recount sees every row. Nothing
-- else writes alliance_snapshots (0176's hand entry writes the roster and the
-- contribution tables, not this one), and nothing deletes from it.
--
-- Named to fire before alliance_growth_refresh and alliance_latest_refresh
-- (triggers fire in name order). Neither reads this table today; the order
-- only means a future one that does would see the new reading.

create table public.alliance_board_readings (
  observation_id uuid primary key,
  board_size bigint not null,
  min_server_id int not null,
  max_server_id int not null,
  counted_at timestamptz not null default now()
);

comment on table public.alliance_board_readings is
  'One row per alliance board reading (observation): how many alliances it '
  'held and the servers it spanned. Maintained by a statement trigger on '
  'alliance_snapshots; read by alliance_power_history instead of recounting.';

create function public.alliance_board_readings_refresh_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.alliance_board_readings
    (observation_id, board_size, min_server_id, max_server_id, counted_at)
  select s.observation_id, count(*), min(s.server_id), max(s.server_id), now()
    from public.alliance_snapshots s
   where s.observation_id in (select distinct n.observation_id from new_rows n)
   group by s.observation_id
  on conflict (observation_id) do update
    set board_size    = excluded.board_size,
        min_server_id = excluded.min_server_id,
        max_server_id = excluded.max_server_id,
        counted_at    = excluded.counted_at;
  return null;
end;
$$;

create trigger alliance_board_readings_refresh
  after insert on public.alliance_snapshots
  referencing new table as new_rows
  for each statement execute function public.alliance_board_readings_refresh_on_write();

-- Backfill every reading already on the table, once.
insert into public.alliance_board_readings
  (observation_id, board_size, min_server_id, max_server_id)
select observation_id, count(*), min(server_id), max(server_id)
  from public.alliance_snapshots
 group by observation_id
on conflict (observation_id) do nothing;

-- ---------------------------------------------------------------------------
-- The view, from its last definition (0153), with the lateral replaced
-- ---------------------------------------------------------------------------
--
-- Every column, name, type and derivation is 0153's. board_scope is still
-- `min <> max`, for 0081's reason. A LEFT join so a reading that somehow has
-- no row here still charts — it reads as a server board of unknown size
-- rather than disappearing — though the trigger and the backfill mean none
-- should exist; 95_board_readings_test pins that.
--
-- Still security_invoker, deliberately (0097): alliance_snapshots is
-- member-only and this view must not become the way around it.
create or replace view public.alliance_power_history
with (security_invoker = true) as
select
  s.alliance_id,
  s.server_id,
  s.captured_at,
  s.power,
  s.rank,
  s.member_count,
  a.current_name as name,
  a.current_code as code,
  a.is_own,
  case
    when o.min_server_id <> o.max_server_id then 'cross_server'
    else 'server'
  end as board_scope,
  o.board_size
from public.alliance_snapshots s
join public.alliances a on a.alliance_id = s.alliance_id
left join public.alliance_board_readings o on o.observation_id = s.observation_id;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Same audience as alliance_snapshots, whose shape this summarises. The gate
-- is written wrapped from the start (0179).
alter table public.alliance_board_readings enable row level security;

grant select on public.alliance_board_readings to authenticated;
grant all on public.alliance_board_readings to service_role;

create policy member_read on public.alliance_board_readings
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

revoke execute on function public.alliance_board_readings_refresh_on_write() from public, anon;
