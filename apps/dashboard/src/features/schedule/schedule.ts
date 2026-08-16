import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarRange } from '../../lib/calendar';
import { supabase } from '../../lib/supabase';
import { fromInputValue, toInputValue, zonedDayKey } from '../../lib/timezone';

/** Reading and writing the calendar (0124).
 *
 * Kept apart from the screen because the OVERLAP RULE is the only thing here
 * that is easy to get wrong, and it is worth being able to point at. An entry
 * that starts before the window and ends inside it belongs on the grid — a
 * three-day event does not vanish because you paged to its second day — so the
 * filter is not "starts in the window".
 */

export interface ScheduleReminder {
  reminder_id: string;
  minutes_before: number;
}

export interface ScheduleEvent {
  schedule_event_id: string;
  title: string;
  body: string | null;
  category: string | null;
  starts_at: string;
  ends_at: string | null;
  source: string;
  series_id: string | null;
  schedule_reminders: ScheduleReminder[];
}

export interface ScheduleCategory {
  category: string;
  label: string;
  colour: string | null;
  channel: string | null;
  sort_order: number;
}

const DAY_MS = 86_400_000;

const COLUMNS =
  'schedule_event_id, title, body, category, starts_at, ends_at, source, series_id,' +
  ' schedule_reminders(reminder_id, minutes_before)';

export function useScheduleEvents(range: CalendarRange) {
  // ONE DAY WIDER AT EACH END, because the grid's cells are days in the
  // READER'S zone and this window is in UTC. A reader in Seoul sees Monday
  // starting nine hours before UTC Monday does, so the first cell reaches back
  // into what UTC still calls Sunday. Over-fetching a day is a few rows;
  // getting it wrong is an entry that silently is not drawn.
  const start = new Date(range.start.getTime() - DAY_MS).toISOString();
  const end = new Date(range.end.getTime() + DAY_MS).toISOString();
  return useQuery({
    queryKey: ['schedule', 'events', start, end],
    queryFn: async (): Promise<ScheduleEvent[]> => {
      const { data, error } = await supabase
        .from('schedule_events')
        .select(COLUMNS)
        // Half-open at the top: an entry at exactly the first instant of the
        // next window belongs to that window, not to both.
        .lt('starts_at', end)
        // And it must not have finished before this window opened. An entry
        // with no end is a moment, so its own start is what has to be inside.
        .or(`ends_at.gte.${start},and(ends_at.is.null,starts_at.gte.${start})`)
        .order('starts_at');
      if (error !== null) {
        throw error;
      }
      return (data ?? []) as unknown as ScheduleEvent[];
    },
  });
}

export function useScheduleCategories() {
  return useQuery({
    queryKey: ['schedule', 'categories'],
    queryFn: async (): Promise<ScheduleCategory[]> => {
      const { data, error } = await supabase
        .from('schedule_categories')
        .select('category, label, colour, channel, sort_order')
        .order('sort_order')
        .order('label');
      if (error !== null) {
        throw error;
      }
      return data ?? [];
    },
    // Categories change when somebody adds a board, which is rarely. The grid
    // re-reads them on every view change otherwise, and they colour every cell.
    staleTime: 10 * 60_000,
  });
}

export interface ScheduleDraft {
  schedule_event_id?: string;
  title: string;
  body: string;
  category: string;
  /** `datetime-local` shapes, read as UTC — see `toIso` in the notices editor
   *  for why: a time typed in Seoul about an 02:00 UTC reset must not land
   *  nine hours out. */
  starts_at: string;
  ends_at: string;
  /** Minutes before the start, one per reminder. */
  reminders: number[];
  /** How often to repeat, and how many times in total. `times` of 1 is a
   *  one-off and writes no series id at all. Only read when creating. */
  repeatEvery: 'day' | 'week';
  repeatTimes: number;
  /** Set when this draft came from an entry that belongs to a repeat, so the
   *  editor can offer to remove the run. Never written by the form. */
  series_id?: string | null;
}

/** Both directions now go through the reader's zone.
 *
 * They used to be a string slice and a `Z` suffix, which was correct only
 * because everything on this screen was UTC. An officer in Seoul typing 20:00
 * into that editor scheduled 20:00 UTC — a reminder at five in the morning
 * their own time, for an event they had just described as an evening one.
 */
export function toLocal(iso: string | null, zone: string): string {
  return toInputValue(iso, zone);
}

/** The wall clocks a repeat produces, in the reader's zone.
 *
 * ADDS DAYS TO THE WALL CLOCK, not 24 hours to the instant. "Every Monday at
 * 20:00" has to stay 20:00 across a clock change; adding 7×24h to the instant
 * would quietly make it 19:00 for the second half of a series that crosses one.
 * Server time has no summer time, so this only shows up for somebody who
 * switched the picker to their own zone — which is exactly the reader least
 * likely to notice the hour had moved.
 */
export function occurrences(startLocal: string, every: 'day' | 'week', times: number): string[] {
  const step = every === 'week' ? 7 : 1;
  const [date, clock] = startLocal.split('T');
  if (date === undefined || clock === undefined) {
    return [startLocal];
  }
  const out: string[] = [];
  for (let index = 0; index < Math.max(1, times); index += 1) {
    const at = new Date(`${date}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + index * step);
    out.push(`${at.toISOString().slice(0, 10)}T${clock}`);
  }
  return out;
}

/** Save an entry and replace its reminders.
 *
 * REPLACE, not merge. The form hands over the reminders it wants to exist, and
 * working out which of the old ones survived would mean comparing two lists by
 * a value the user can edit. Deleting and re-inserting inside one save is
 * cheaper to reason about — and it costs nothing, because a reminder has no
 * history worth keeping: `notification_outbox` holds what was actually sent.
 */
export function useSaveScheduleEvent(zone: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ScheduleDraft) => {
      const starts = fromInputValue(draft.starts_at, zone);
      if (starts === null) {
        throw new Error('An entry needs a start time.');
      }
      const common = {
        title: draft.title.trim(),
        body: draft.body.trim() === '' ? null : draft.body.trim(),
        category: draft.category === '' ? null : draft.category,
      };
      // A repeat only happens on CREATE. Editing one occurrence edits that
      // occurrence — re-expanding here would silently replace a series somebody
      // had already moved two entries of, and there is no undo on this screen.
      const times =
        draft.schedule_event_id === undefined ? Math.max(1, Math.min(52, draft.repeatTimes)) : 1;
      const seriesId = times > 1 ? crypto.randomUUID() : null;
      const startLocals = occurrences(draft.starts_at, draft.repeatEvery, times);
      // The end moves with the start, by the same number of days, so a
      // three-hour window stays three hours on every occurrence.
      const endLocals =
        draft.ends_at.trim() === ''
          ? startLocals.map(() => '')
          : occurrences(draft.ends_at, draft.repeatEvery, times);

      const rows = startLocals.map((startLocal, index) => ({
        ...common,
        starts_at: fromInputValue(startLocal, zone) ?? starts,
        ends_at: fromInputValue(endLocals[index] ?? '', zone),
        series_id: seriesId,
      }));

      const saved =
        draft.schedule_event_id === undefined
          ? await supabase.from('schedule_events').insert(rows).select('schedule_event_id')
          : await supabase
              .from('schedule_events')
              .update(rows[0] ?? {})
              .eq('schedule_event_id', draft.schedule_event_id)
              .select('schedule_event_id');
      if (saved.error !== null) {
        throw saved.error;
      }
      const eventIds = (saved.data ?? []).map((entry) => entry.schedule_event_id);

      const wipe = await supabase
        .from('schedule_reminders')
        .delete()
        .in('schedule_event_id', eventIds);
      if (wipe.error !== null) {
        throw wipe.error;
      }
      // Deduplicated here as well as by the table's unique constraint: two
      // identical reminders in the form is a slip, and a 23505 back from the
      // database is a worse way to be told about it than simply not having one.
      const minutes = [...new Set(draft.reminders)].filter((value) => value >= 0);
      if (minutes.length > 0) {
        // One set per occurrence. Each reminder is relative to the entry it
        // hangs on, so the fourth Monday reminds before the fourth Monday.
        const written = await supabase
          .from('schedule_reminders')
          .insert(
            eventIds.flatMap((schedule_event_id) =>
              minutes.map((minutes_before) => ({ schedule_event_id, minutes_before })),
            ),
          );
        if (written.error !== null) {
          throw written.error;
        }
      }
      return eventIds[0] ?? null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
}

export function useDeleteSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (seriesId: string) => {
      const { error } = await supabase.from('schedule_events').delete().eq('series_id', seriesId);
      if (error !== null) {
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
}

export function useDeleteScheduleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (scheduleEventId: string) => {
      // Reminders go with it: the FK cascades, so this does not have to.
      const { error } = await supabase
        .from('schedule_events')
        .delete()
        .eq('schedule_event_id', scheduleEventId);
      if (error !== null) {
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
}

/** Which day cells an entry belongs in, as `YYYY-MM-DD` keys.
 *
 * A span covers every day it touches. Drawn only on its first day, a
 * three-day event is invisible on the two days somebody is actually checking
 * whether they are free.
 */
export function daysCovered(event: ScheduleEvent, zone: string): string[] {
  const start = zonedDayKey(event.starts_at, zone);
  if (event.ends_at === null) {
    return [start];
  }
  const last = zonedDayKey(event.ends_at, zone);
  const out: string[] = [];
  // Walked as DATES rather than as instants: the two ends have already been
  // resolved to days in the reader's zone, and stepping 24 hours through a
  // clock change would skip or repeat one of them.
  for (let at = new Date(`${start}T00:00:00Z`); ; at = new Date(at.getTime() + DAY_MS)) {
    const key = at.toISOString().slice(0, 10);
    out.push(key);
    if (key >= last || out.length > 400) {
      break;
    }
  }
  return out;
}

export interface CategoryDraft {
  /** Empty for a new board — the key is derived from the label on save and
   *  never changes afterwards, so renaming a board keeps its entries. */
  category: string;
  label: string;
  colour: string;
  channel: string;
  sort_order: number;
}

/** A key from a label, once.
 *
 * The key is a primary key that `schedule_events.category` points at, so
 * re-deriving it on every rename would orphan every entry already filed under
 * the old one. Derived rather than typed because nobody adding "Bear hunt"
 * should have to think about what a slug is — and a collision just gets a
 * suffix rather than an error about a duplicate key.
 */
export function categoryKey(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'board';
  if (!taken.includes(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}

export function useSaveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: CategoryDraft) => {
      const row = {
        category: draft.category,
        label: draft.label.trim(),
        colour: draft.colour.trim() === '' ? null : draft.colour.trim(),
        channel: draft.channel === '' ? null : draft.channel,
        sort_order: draft.sort_order,
      };
      // Upsert rather than insert-or-update: the key is decided by the caller
      // before this runs, so there is nothing here to branch on.
      const { error } = await supabase.from('schedule_categories').upsert(row);
      if (error !== null) {
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (category: string) => {
      // Entries keep their place on the calendar and lose their board:
      // `schedule_events.category` is ON DELETE SET NULL. Deleting a board is
      // not a way to delete a fortnight of entries by accident.
      const { error } = await supabase
        .from('schedule_categories')
        .delete()
        .eq('category', category);
      if (error !== null) {
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
}
