-- 0126: repeating entries, stored as the entries they are.
--
-- "Every Monday, four times" becomes FOUR ROWS that happen to share an id, not
-- one row with a rule on it. 0124 said no recurrence and gave the reason; this
-- adds it in the shape that reason allows.
--
-- A RULE DRAGS ITS EXCEPTIONS BEHIND IT. The moment a series exists as a rule,
-- the calendar needs somewhere to put "this week moved an hour", "skip the one
-- on the 14th", "the rest of them start at 21:00 from now on" — and every
-- reader of the table has to know about both shapes. Four rows need none of
-- that: moving one is an ordinary edit, skipping one is an ordinary delete, and
-- the calendar, the reminder view and the notifier keep reading exactly what
-- they read before this migration.
--
-- The cost is that a series is bounded. That is what was asked for — a count,
-- not "forever" — and an unbounded series is the case that forces the rule back
-- anyway, because you cannot materialise infinity.
alter table public.schedule_events
  add column series_id uuid;

comment on column public.schedule_events.series_id is
  'Groups the occurrences created together by one repeat. Null for a one-off. '
  'Not a foreign key and not a table: there is nothing about a series worth '
  'storing that the occurrences do not already say, and a parent row would be '
  'a second place for the title and the time to disagree.';

-- Only for "delete the whole series", which is the one question anybody asks
-- of it. Partial, because most entries are one-offs and a null series_id is
-- never searched for.
create index schedule_events_series_idx on public.schedule_events (series_id)
  where series_id is not null;

-- NO RLS CHANGE. The column sits on a table whose policies already say who may
-- read and write an entry (0124), and a series is entries. Worth stating
-- because adding a column is exactly when a policy quietly stops covering the
-- whole row — `for all` on the table covers this one, and 72_schedule_board_test
-- still proves a member cannot insert.
