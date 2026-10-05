-- 0235: which packs the server offers now.
--
-- shop_pack_snapshots rows are keyed by the pack's content, so an unchanged
-- pack is never written again and its captured_at stays where it was first
-- seen: on 2026-10-05 the Packs tab showed 539 packs for 580 and only one of
-- them carried the newest capture time. Every exchange.info capture is the
-- account's whole catalog — 381 entries, all inside their start-end window —
-- so this records, once per capture, which pack ids it listed. The newest row
-- per server is what is on sale there now; a pack not in it is no longer
-- offered (the dashboard hides it, user 2026-10-05).

create table public.shop_pack_catalogs (
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
  pack_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(pack_ids) = 'array')
);

create index shop_pack_catalogs_server_captured_idx
  on public.shop_pack_catalogs (server_id, captured_at desc);

alter table public.shop_pack_catalogs enable row level security;
revoke all on public.shop_pack_catalogs from anon, authenticated;
grant select on public.shop_pack_catalogs to authenticated;
grant all on public.shop_pack_catalogs to service_role;

create policy member_read on public.shop_pack_catalogs
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- The newest catalog per server.
create view public.shop_pack_catalog_latest
with (security_invoker = true) as
select distinct on (c.server_id) c.server_id, c.captured_at, c.pack_ids
from public.shop_pack_catalogs c
order by c.server_id, c.captured_at desc;

revoke all on public.shop_pack_catalog_latest from anon, authenticated;
grant select on public.shop_pack_catalog_latest to authenticated;
grant select on public.shop_pack_catalog_latest to service_role;
