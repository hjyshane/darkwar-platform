-- 0197: changing which alliances are ours never changes anybody's settings.
--
-- Phase 5 of docs/superpowers/plans/2026-09-28-multi-alliance.md, the pin
-- screen, lets an admin add a second alliance and choose which one is
-- PRIMARY. 0195 made the primary's per-alliance settings live in the shared
-- app_settings row, and every alliance without its own override reads that
-- same row. Two consequences, both silent:
--
--   * A newly pinned alliance has no override, so it reads the primary's
--     rank tiers — fine on the day it is added, wrong the first time the
--     primary's officers edit theirs, because the edit moves both.
--   * Swapping the primary hands the shared row to the new primary. The old
--     primary, with no override of its own, now reads the NEW primary's
--     numbers the moment either side edits.
--
-- The fix is to freeze, not to redesign: whenever the pin list changes,
-- every own alliance that is not primary and has no override for a
-- per-alliance key gets one, copied from the shared row as it stands at that
-- instant. And the primary's own override, if it has one (it was pinned
-- second before being promoted), moves INTO the shared row. Each alliance
-- keeps exactly the numbers it had; from then on only its own officers move
-- them. The primary keeps reading app_settings, so the rank build and every
-- other existing reader are untouched.

create function public.freeze_alliance_settings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary uuid := public.primary_own_alliance();
begin
  insert into public.alliance_settings (alliance_id, key, value, updated_by)
  select a.alliance_id, s.key, s.value, s.updated_by
  from public.alliances a
  cross join public.app_settings s
  where a.is_own
    and a.alliance_id is distinct from v_primary
    -- The per-alliance keys: the same list alliance_settings_known_key and
    -- save_alliance_setting carry (0195).
    and s.key in ('rank_tiers')
  on conflict (alliance_id, key) do nothing;

  -- THEN the new primary's own values move into the shared row, and its
  -- override goes. Without this a promoted alliance would keep reading its
  -- override (alliance_setting prefers it) while its officers' edits land in
  -- app_settings (save_alliance_setting writes the primary's there) — every
  -- edit accepted and none of them taking effect. Second, so the copies
  -- above were taken from the OLD primary's values.
  -- An upsert, not an update: with no shared row yet, an update would do
  -- nothing and the delete below would throw the values away.
  insert into public.app_settings (key, value, updated_by)
  select o.key, o.value, o.updated_by
  from public.alliance_settings o
  where o.alliance_id = v_primary
    and o.key in ('rank_tiers')
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by;
  delete from public.alliance_settings
   where alliance_id = v_primary
     and key in ('rank_tiers');
end;
$$;

revoke all on function public.freeze_alliance_settings() from public, anon, authenticated;

comment on function public.freeze_alliance_settings() is
  'Give every non-primary own alliance its own copy of each per-alliance '
  'setting it does not yet override, taken from app_settings as it stands. '
  'Run when the pin list changes, so a change of primary or a newly pinned '
  'alliance never changes the numbers any alliance is using.';

-- 0032's trigger body, with the freeze after the resolve: is_own has to be
-- current before "which alliances are ours and not primary" can be asked.
create or replace function public.app_settings_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.key, old.key) = 'own_alliance' then
    perform public.resolve_own_alliance();
    perform public.freeze_alliance_settings();
  end if;
  return null;
end;
$$;
