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
