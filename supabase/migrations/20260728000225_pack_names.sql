-- 0225: pack names officers can correct, like item names (0216).
--
-- A pack's name is the game's string for its name_key (game_strings), or
-- "Pack #<id>" when the client has none. Officers asked to fix the ones that
-- read wrong or not at all. The correction is keyed by the name_key — every
-- id the game lists one offer under, and every reissue, shares it — or by
-- "pack:<id>" for a pack without one. The game data never overwrites it;
-- the dashboard shows it instead of the game's name and keeps the game's
-- name for grouping, so a rename never splits or hides an offer.

create table public.game_pack_names (
  pack_key text primary key check (length(pack_key) between 1 and 120),
  name text not null check (length(btrim(name)) between 1 and 80),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.game_pack_names is
  'Officer corrections to pack names (0225), keyed by the pack''s name_key or '
  '"pack:<id>". Shown instead of the game''s name; never overwritten by it.';

create trigger game_pack_names_set_updated_at
  before update on public.game_pack_names
  for each row execute function public.set_updated_at();

alter table public.game_pack_names enable row level security;
revoke all on public.game_pack_names from anon, authenticated;
grant select, insert, update, delete on public.game_pack_names to authenticated;
grant all on public.game_pack_names to service_role;

create policy member_read on public.game_pack_names
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy officer_insert on public.game_pack_names
  for insert to authenticated
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_update on public.game_pack_names
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_delete on public.game_pack_names
  for delete to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));
