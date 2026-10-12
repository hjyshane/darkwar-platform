-- 0282: a role for people outside the alliance.
--
-- 'community' is the Korean community: players from other alliances invited
-- to read the game-wide reference pages (overview of scanned servers,
-- rankings, migration, map, planner, game calendar, event guide, shop value).
--
-- THIS FILE ONLY ADDS THE VALUE. A new enum value cannot be used in the
-- transaction that adds it ("unsafe use of new enum value"), and 0283 needs to
-- name it in policies, so the two are separate files.
--
-- Deny by default: every policy in this schema spells the roles it admits
-- ('member', 'officer', 'admin'), so a community account reads NOTHING until
-- 0283 names the tables it may read. It is not "member minus things".

alter type public.app_role add value if not exists 'community';
