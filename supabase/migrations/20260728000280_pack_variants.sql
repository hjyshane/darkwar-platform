-- 0280: which variant of a pack is the one this server sells.
--
-- The game lists several packs under one name and price that differ only in
-- what is inside: the Pioneer / Commander / Overlord / Integrated daily
-- packages come in four stages (Precision Part x4/5/6 ...), the custom weekly
-- passes in five, Treasure of the Day in two kinds. The server sends every
-- one; the client picks the one the account sees by conditions the game data
-- does not explain (214/215 in custom_dailypackage). Nothing in a capture
-- says which is ours, so an officer says so once per name and the page hides
-- the rest.
--
--   family_key  : the game's pack name and the price, "Pioneer Package|0.99"
--   variant_key : a hash of the variant's contents and picks, so it survives
--                 the game reissuing the offer under new ids and stops
--                 matching when the contents change (the officer picks again)

create table public.game_pack_variants (
  family_key text primary key check (length(family_key) between 1 and 200),
  variant_key text not null check (length(variant_key) between 1 and 80),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table public.game_pack_variants is
  'The variant of a same-name, same-price pack that this server sells, chosen '
  'by an officer (0280). One row per "<game name>|<price>".';

create trigger game_pack_variants_set_updated_at
  before update on public.game_pack_variants
  for each row execute function public.set_updated_at();

alter table public.game_pack_variants enable row level security;
revoke all on public.game_pack_variants from anon, authenticated;
grant select, insert, update, delete on public.game_pack_variants to authenticated;
grant all on public.game_pack_variants to service_role;

create policy member_read on public.game_pack_variants
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));
create policy officer_insert on public.game_pack_variants
  for insert to authenticated
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_update on public.game_pack_variants
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));
create policy officer_delete on public.game_pack_variants
  for delete to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));
