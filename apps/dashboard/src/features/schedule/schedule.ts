import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarRange } from '../../lib/calendar';
import { supabase } from '../../lib/supabase';

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
  schedule_reminders: ScheduleReminder[];
}

export interface ScheduleCategory {
  category: string;
  label: string;
  colour: string | null;
  channel: string | null;
  sort_order: number;
}

const COLUMNS =
  'schedule_event_id, title, body, category, starts_at, ends_at, source,' +
  ' schedule_reminders(reminder_id, minutes_before)';

export function useScheduleEvents(range: CalendarRange) {
  const start = range.start.toISOString();
  const end = range.end.toISOString();
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
}

function toIso(local: string): string | null {
  return local.trim() === '' ? null : new Date(`${local}:00Z`).toISOString();
}

export function toLocal(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 16);
}

/** Save an entry and replace its reminders.
 *
 * REPLACE, not merge. The form hands over the reminders it wants to exist, and
 * working out which of the old ones survived would mean comparing two lists by
 * a value the user can edit. Deleting and re-inserting inside one save is
 * cheaper to reason about — and it costs nothing, because a reminder has no
 * history worth keeping: `notification_outbox` holds what was actually sent.
 */
export function useSaveScheduleEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ScheduleDraft) => {
      const starts = toIso(draft.starts_at);
      if (starts === null) {
        throw new Error('An entry needs a start time.');
      }
      const row = {
        title: draft.title.trim(),
        body: draft.body.trim() === '' ? null : draft.body.trim(),
        category: draft.category === '' ? null : draft.category,
        starts_at: starts,
        ends_at: toIso(draft.ends_at),
      };
      const saved =
        draft.schedule_event_id === undefined
          ? await supabase.from('schedule_events').insert(row).select('schedule_event_id').single()
          : await supabase
              .from('schedule_events')
              .update(row)
              .eq('schedule_event_id', draft.schedule_event_id)
              .select('schedule_event_id')
              .single();
      if (saved.error !== null) {
        throw saved.error;
      }
      const eventId = saved.data.schedule_event_id;

      const wipe = await supabase
        .from('schedule_reminders')
        .delete()
        .eq('schedule_event_id', eventId);
      if (wipe.error !== null) {
        throw wipe.error;
      }
      // Deduplicated here as well as by the table's unique constraint: two
      // identical reminders in the form is a slip, and a 23505 back from the
      // database is a worse way to be told about it than simply not having one.
      const minutes = [...new Set(draft.reminders)].filter((value) => value >= 0);
      if (minutes.length > 0) {
        const written = await supabase
          .from('schedule_reminders')
          .insert(
            minutes.map((minutes_before) => ({ schedule_event_id: eventId, minutes_before })),
          );
        if (written.error !== null) {
          throw written.error;
        }
      }
      return eventId;
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
export function daysCovered(event: ScheduleEvent): string[] {
  const start = event.starts_at.slice(0, 10);
  if (event.ends_at === null) {
    return [start];
  }
  const out: string[] = [];
  const last = new Date(`${event.ends_at.slice(0, 10)}T00:00:00Z`);
  for (
    let at = new Date(`${start}T00:00:00Z`);
    at <= last;
    at = new Date(at.getTime() + 86_400_000)
  ) {
    out.push(at.toISOString().slice(0, 10));
  }
  return out;
}

/** Channel NAMES, from 0125's view.
 *
 * Not `notification_channels`: that table holds the webhook URL and is
 * admin-only including select (0076), so an officer reading it gets an empty
 * list — and an empty list here is a dropdown they cannot fill in, with a
 * foreign key waiting to reject whatever they type instead.
 */
export function useChannelNames() {
  return useQuery({
    queryKey: ['schedule', 'channels'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('notification_channel_names')
        .select('channel, enabled')
        .order('channel');
      if (error !== null) {
        throw error;
      }
      return (data ?? []).map((row) => row.channel).filter((name): name is string => name !== null);
    },
    staleTime: 10 * 60_000,
  });
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
