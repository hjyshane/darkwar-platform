-- 0315: season sites — the floating lantern and what it reveals, for the map.
--
-- The Kitsune season (from 2026-11-09) floats unlit lanterns across the map
-- during its Miasma Bursts. A light-bearing troop passing one lights it, and a
-- site opens underneath for an hour: a Large Treasure Spot, or one of three
-- statues, or a pile of scrap. On the wire every one of those is ONE object:
-- map tile type 29, the client's WorldLuckyCatStatueObject, `luckyCat` in
-- world.get.detail.new, which each season skins anew. Its `f101` carries the
-- site uuid (f1), the cat id (f2), the expiry (f3), and once lit the reveal
-- instant (f4), the open duration (f5) and the participants (f7); f8 is the
-- status, 3 unlit, 0 lit, 1 revealing, 2 open.
--
-- THE CAT ID IS FIXED FROM SPAWN AND NAMES THE CONTENT. It is the key into the
-- client's `lucky_cats` table, whose hundreds say what the lantern hides: 11xx
-- Pile of Scrap, 12xx Large Jizo Statue, 13xx Large Kitsune Statue, 14xx Large
-- Daruma Statue, 15xx Large Treasure Spot. So which unlit lanterns are worth a
-- march is known before anybody lights one, and that is what the map shows.
-- Confirmed 2026-11-10 against two in-game share links the operator pasted.
--
-- A snapshot table written by the collector like every other capture, read by
-- members; the view gives the map what is still standing. SECURITY INVOKER so
-- the members-only policy applies to whoever reads it (0254).

create table public.season_site_snapshots (
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

  -- The map's server (the tile's f103): a site stands on one server's ground
  -- and has no owner to take a server from. No FK, as 0254: a failed insert
  -- would stall the outbox.
  server_id int not null,
  point_id bigint not null,
  x int not null,
  y int not null,
  -- Text: the game's uuid is a 19-digit number, past what a JSON reader keeps exactly.
  site_uuid text not null,
  cat_id int not null,
  status smallint not null,
  -- The game's own instants. Every state has an expiry; the reveal and the
  -- open duration arrive once the lantern is lit.
  expires_at timestamptz not null,
  revealed_at timestamptz,
  limit_seconds int,
  participant_uids jsonb not null default '[]'::jsonb
);

create index season_site_snapshots_site_idx
  on public.season_site_snapshots (site_uuid, captured_at desc);

alter table public.season_site_snapshots enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated everything,
-- TRUNCATE included (0207).
revoke all on public.season_site_snapshots from anon, authenticated;
grant select on public.season_site_snapshots to authenticated;
grant all on public.season_site_snapshots to service_role;

create policy member_read on public.season_site_snapshots
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

comment on table public.season_site_snapshots is
  'Season sites seen on the world map (0315, object type 29): the floating lantern and '
  'the site it reveals, in every state. cat_id is the client''s lucky_cats key and names '
  'the content (15xx = Large Treasure Spot); status 3 unlit, 0 lit, 1 revealing, 2 open.';

-- What is still standing: the newest state of each site seen in the last day,
-- not yet expired, and — once open — not yet past its hour.
--
-- THE GAME NAMES A SITE ONE SQUARE OFF FROM ITS TILE. Both share links the
-- operator pasted read (x-1, y-1) of the tile the viewport put the site on; the
-- object has `size` 3 in lucky_cats, so the game is naming another square of
-- the same footprint. game_x / game_y are that form — what a player types to
-- jump there — and are computed here so the dashboard and the notifier read
-- one rule rather than each restating it. x / y stay the tile, which is where
-- our own map draws everything else. Two samples, not a derivation; if a third
-- disagrees, this is the one place to change.

create view public.season_sites_live
with (security_invoker = true) as
select latest.*,
       latest.cat_id / 100 as cat_group,
       latest.x - 1 as game_x,
       latest.y - 1 as game_y
  from (
    select distinct on (s.site_uuid)
           s.site_uuid,
           s.server_id,
           s.point_id,
           s.x,
           s.y,
           s.cat_id,
           s.status,
           s.expires_at,
           s.revealed_at,
           s.limit_seconds,
           jsonb_array_length(s.participant_uids) as participant_count,
           s.captured_at as seen_at
      from public.season_site_snapshots s
     where s.captured_at > now() - interval '1 day'
     order by s.site_uuid, s.captured_at desc
  ) latest
 where latest.expires_at > now()
   and (latest.revealed_at is null
        or latest.limit_seconds is null
        or latest.revealed_at + make_interval(secs => latest.limit_seconds) > now());

revoke all on public.season_sites_live from anon, authenticated;
grant select on public.season_sites_live to authenticated;
grant all on public.season_sites_live to service_role;

comment on view public.season_sites_live is
  'Season sites still standing (0315): newest state per site, not expired, open ones '
  'within their hour. cat_group is cat_id / 100 (15 = Large Treasure Spot); game_x / '
  'game_y is the coordinate the game shows for the site, one less than the tile on both axes.';
