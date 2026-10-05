-- 0234: pet portraits.
--
-- The client's `pet` table names a round portrait per pet
-- (pet_record_img_pet_01 ... _07, 120 px), the one its pet record shows; the
-- cross-server pet boards draw it beside the pet's name. Members only, like
-- every icon (0232).

alter table public.game_icon_refs drop constraint game_icon_refs_kind_check;
alter table public.game_icon_refs
  add constraint game_icon_refs_kind_check
  check (kind in ('hero', 'exclusive', 'gear', 'item', 'resource', 'ui', 'pet'));
