-- 0307: which request shapes the game client sends, per command.
--
-- The collector now journals the client's own requests (masked, local only).
-- What reaches the cloud is the SHAPE of a request - key names and value types,
-- never a value - once per (command, shape), so the discovery inbox can say not
-- only which commands the game speaks but what it asks them with. Same rule as
-- schema_observations: the collector builds the skeleton before it leaves the
-- machine (discovery.payload_shape over an already-masked payload).
--
-- Admin read only, like the inbox beside it. No write policy: the collector
-- writes with the service key, which bypasses RLS, and nobody else should.

create table public.command_request_shapes (
  command_request_shape_id uuid primary key default gen_random_uuid(),
  collector_id uuid references public.collectors (collector_id),
  source_command text not null,
  fingerprint text not null,
  sample jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_command, fingerprint)
);

alter table public.command_request_shapes enable row level security;

-- 0065 inverted the default: authenticated gets nothing unless a table grants it.
grant select on public.command_request_shapes to authenticated;
revoke all on public.command_request_shapes from anon;

create policy admin_read on public.command_request_shapes
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');

-- Sync merges duplicates on the natural key. A second collector reporting the
-- same shape must widen the window, not shrink it.
create function public.keep_request_shape_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.first_seen_at := least(old.first_seen_at, new.first_seen_at);
  new.last_seen_at := greatest(old.last_seen_at, new.last_seen_at);
  return new;
end;
$$;

create trigger command_request_shapes_window
  before update on public.command_request_shapes
  for each row execute function public.keep_request_shape_window();
