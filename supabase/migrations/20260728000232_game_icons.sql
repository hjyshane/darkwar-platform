-- 0232: game icons, members only.
--
-- The client's asset pack holds the art for every hero, exclusive weapon,
-- gear piece and item (dw-collector game-icons cuts them out as ~96 px WebP,
-- 102 of them at 259 KB for the first batch). The art is the game company's,
-- so it is not served from a public URL: it lives here, behind the same
-- member-read RLS as the rest of the catalogue, and the dashboard fetches it
-- with the reader's session (user, 2026-10-05: signed-in readers only).
--
--   game_icons      icon_key (the client's sprite name) -> base64 WebP
--   game_icon_refs  (kind, ref_id) -> icon_key; kind is hero / exclusive /
--                   gear / item, ref_id the hero id, gear equipId or item id
--
-- Not Supabase Storage (still deferred, CLAUDE.md): rows a member can read
-- are the gate the dashboard already has.

create table public.game_icons (
  icon_key text primary key check (length(icon_key) between 1 and 200),
  image text not null check (length(image) between 1 and 200000),
  width int not null,
  height int not null,
  updated_at timestamptz not null default now()
);

create table public.game_icon_refs (
  kind text not null check (kind in ('hero', 'exclusive', 'gear', 'item')),
  ref_id text not null,
  icon_key text not null,
  updated_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

comment on table public.game_icons is
  'Game art as base64 WebP, from the client''s asset pack (0232). Members only; '
  'written by dw-collector game-icons.';
comment on table public.game_icon_refs is
  'Which game_icons sprite draws each hero, exclusive weapon, gear piece and '
  'item (0232). Written by dw-collector game-icons.';

alter table public.game_icons enable row level security;
alter table public.game_icon_refs enable row level security;
revoke all on public.game_icons from anon, authenticated;
revoke all on public.game_icon_refs from anon, authenticated;
grant select on public.game_icons to authenticated;
grant select on public.game_icon_refs to authenticated;
grant all on public.game_icons to service_role;
grant all on public.game_icon_refs to service_role;

create policy member_read on public.game_icons
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy member_read on public.game_icon_refs
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
