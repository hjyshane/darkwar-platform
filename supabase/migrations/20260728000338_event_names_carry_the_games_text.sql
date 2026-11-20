-- 0338: event_names carries the game's own text - what an event is, in the
-- client's words.
--
-- The calendar named an event and stopped there: a member who did not already
-- know what "Arctic Veins" was learned nothing from seeing it on Tuesday. The
-- client has the answer in the same activity_panel row the name comes from
-- (0208, 0210) - `desc_info` is the one-line pitch under the title, `story` is
-- the rules screen behind the (i) - and `dw-collector game-names` already
-- reads that row. It now writes both here, as plain text (the client's
-- <color> and <b> markup removed, its literal \n made a line break), and the
-- calendar shows them on the card an event opens.
--
--   summary  activity_panel.desc_info, localised. 1,277 of 1,477 events have one.
--   rules    activity_panel.story, localised. 861 have one; the longest is 2,705
--            characters.
--
-- On event_names rather than a table of their own: same key, same writer, same
-- readers, and the card reads one row by its primary key. Not on
-- event_schedule_current: that view is the whole calendar in one response and
-- would carry ~450 KB of prose nobody asked for to draw bars.
--
-- Deliberately not done:
--   - No new policy or grant. The columns are read and written by exactly the
--     roles that read and write the name (0208, 0283).
--   - Nothing for an id the client's table does not have (40401 on 2026-11-19):
--     there is no row to read text from. Those stay unnamed until an officer
--     names them, and the calendar now lists them apart.
--   - A person's rename keeps the row theirs (0210) and does not touch these;
--     the tool refreshes them on every row, since nobody types them.

alter table public.event_names
  add column summary text check (summary is null or length(summary) <= 2000),
  add column rules text check (rules is null or length(rules) <= 20000);

comment on column public.event_names.summary is
  'The client''s one-line description (activity_panel.desc_info), plain text (0338).';
comment on column public.event_names.rules is
  'The client''s rules screen (activity_panel.story), plain text (0338).';
