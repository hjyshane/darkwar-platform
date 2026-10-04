-- 0227: a pack rename belongs to one offer, not to every pack sharing a name.
--
-- 0225 keyed game_pack_names by the pack's name_key, so renaming one "VIP
-- Exclusive" renamed every VIP Exclusive — each VIP level's pack, with
-- different contents (user, 2026-10-04). The dashboard now keys a rename by
-- the offer itself: name_key (or the id), price, rubies and contents — the
-- same identity the Packs tab groups by, so the ids one offer is listed under
-- and its reissues still share a rename, and different offers never do.
--
-- That key is longer than 0225 allowed. The one rename saved under the old
-- key ("VIP exclusive 3" on 320204) cannot say which of the VIP packs it
-- meant, so it goes; it has to be entered again on the right pack.

alter table public.game_pack_names drop constraint game_pack_names_pack_key_check;
alter table public.game_pack_names
  add constraint game_pack_names_pack_key_check check (length(pack_key) between 1 and 2000);

delete from public.game_pack_names where pack_key not like '%|%';

comment on table public.game_pack_names is
  'Officer corrections to pack names (0225), one per offer: keyed '
  '"<name_key or pack:id>|<dollars>|<rubies>|<contents>" (0227). Shown instead '
  'of the game''s name; never overwritten by it.';
