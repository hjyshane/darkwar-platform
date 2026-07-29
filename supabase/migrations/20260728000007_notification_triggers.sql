-- 0007 (S9): snapshot inserts emit lightweight realtime signals.
--
-- Statement-level triggers with transition tables: one notification per
-- INSERT statement, not per row — a 100-row roster sync produces one
-- signal, and the UI refetches the affected panel once (FR-UI-005). The
-- notification carries topic + server_id + count only; subscribers query
-- the snapshot tables through their own RLS for actual data.

create function public.notify_data_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.data_change_notifications (topic, server_id, payload)
  select
    tg_table_name,
    -- Single-server statements carry the id so the UI can scope the
    -- refetch; mixed batches leave it null (refetch unscoped).
    case when count(distinct server_id) = 1 then min(server_id) end,
    jsonb_build_object('count', count(*))
  from new_rows
  having count(*) > 0;
  return null;
end;
$$;

create trigger player_snapshots_notify
  after insert on public.player_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger player_detail_snapshots_notify
  after insert on public.player_detail_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger alliance_snapshots_notify
  after insert on public.alliance_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger alliance_member_snapshots_notify
  after insert on public.alliance_member_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger arena_matches_notify
  after insert on public.arena_matches
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger arena_snapshots_notify
  after insert on public.arena_snapshots
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();

create trigger arena_entries_notify
  after insert on public.arena_entries
  referencing new table as new_rows
  for each statement execute function public.notify_data_change();
