-- 0350: no_server_translation - the content_translations cache (0349) goes.
--
-- 0349 was written for translating posts through a model API from an Edge
-- Function. The owner then chose (2026-11-24) translation in the reader's own
-- browser instead - no server, no API, nothing stored - but the first version
-- had already been merged. This drops what it created. 0349 stays in the
-- chain rather than being deleted, because a database that has applied it
-- would otherwise disagree with the repository about its history.
--
-- Nothing reads the table: the dashboard translates on the reader's machine
-- (apps/dashboard/src/lib/contentTranslation.tsx) and the translate Edge
-- Function is removed from the repository in the same change.

drop table if exists public.content_translations;
