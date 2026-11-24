-- 0351: calendar_categories_an_admin_adds - an event can be filed under a
-- category an admin made, not only the six built in.
--
-- WHY. Since 2026-11-24 an admin arranges the game calendar's categories in
-- Settings › Shared › Site values (app_settings 'site.calendar_categories'):
-- renames, reorders, hides, and ADDS them. Officers file events into them from
-- the calendar, which writes event_names.category - and 0211's check let only
-- the six built-in keys through, so filing into a new one was refused.
--
-- WHAT. The list of six becomes a shape: a lowercase slug, the same one the
-- dashboard makes keys with (categoryModel.ts, CATEGORY_KEY). Which keys
-- EXIST is the admin's list's business, not the table's: a key whose category
-- was removed is drawn under "Events", where an unfiled event has always gone,
-- and filing it again fixes it. Keeping the check a shape means removing a
-- category never needs a migration or rewrites anybody's rows.
--
-- Nothing else changes: who may file (0208's officer/admin policies) and the
-- built-in keys, which still pass.

alter table public.event_names drop constraint event_names_category_check;

alter table public.event_names
  add constraint event_names_category_check check (
    category is null or category ~ '^[a-z][a-z0-9_-]{0,39}$'
  );

-- The old "shown at first" choice (site.calendar_default_shown) becomes the
-- category list's shownAtFirst flags, and the old row goes. The dashboard used
-- to fall back to the old row whenever the new one was missing, which brought
-- a retired choice back every time an admin reset the categories to default
-- (codex review on #680). Moving it once here removes the fallback.
insert into public.app_settings (key, value)
select 'site.calendar_categories',
       jsonb_agg(
         jsonb_build_object(
           'key', c.key, 'label', null, 'hidden', false,
           'shownAtFirst', old.value ? c.key)
         order by c.ord)
  from public.app_settings old
 cross join unnest(array['major', 'recurring', 'season', 'event', 'pass', 'premium'])
       with ordinality as c(key, ord)
 where old.key = 'site.calendar_default_shown'
   and jsonb_typeof(old.value) = 'array'
 group by old.value
on conflict (key) do nothing;

delete from public.app_settings where key = 'site.calendar_default_shown';
