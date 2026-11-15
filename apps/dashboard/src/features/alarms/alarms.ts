import type { Database } from '@dw/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllianceSetting } from '../../lib/allianceSetting';
import { supabase } from '../../lib/supabase';
import {
  AHEAD_MS,
  type AlarmBoard,
  type AlarmEntry,
  type AlarmStep,
  type Delivery,
  type EntryTimesDraft,
  checkEntry,
  orderSteps,
  pingRole,
  reminderDiff,
  stepMinutes,
  wholeSecond,
} from './alarmLogic';
import { categoryKey } from './boardLogic';

/** The Alarms tab's reads and writes (spec §1, §5, §8).
 *
 * NO ALLIANCE FILTER: 0194's `alliance_scope` policies hold every table here to
 * the alliance being viewed, and an insert takes it from the column default.
 * EVERY UPDATE HAS A FILTER: prod runs pg_safeupdate, which refuses an UPDATE
 * with no WHERE even when RLS would narrow it — and only prod does.
 */

const KEY = ['alarms'] as const;
/** The chips follow the minute job: what it sent is read again this often. */
const DELIVERIES_POLL_MS = 60_000;

type ReminderRow = Database['public']['Tables']['schedule_reminders']['Row'];

function throwIf(error: { message: string } | null): void {
  if (error !== null) {
    throw error;
  }
}

/** Every write here changes what the tab shows, so each invalidates it all. */
function useAlarmMutation<T, R = void>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

function toStep(row: Omit<ReminderRow, 'schedule_event_id' | 'created_at'>): AlarmStep {
  return {
    reminderId: row.reminder_id,
    anchor: row.anchor === 'end' ? 'end' : 'start',
    minutesBefore: row.minutes_before,
    sendAt: row.send_at,
    enabled: row.enabled,
  };
}

/** The row to insert for a step. A one-off is always `start`-anchored (0322's
 *  check) and its time is whole seconds, so `stepKey` matches the database. */
function reminderRow(entryId: string, step: AlarmStep) {
  const once = step.sendAt !== null;
  return {
    schedule_event_id: entryId,
    anchor: once ? 'start' : step.anchor,
    minutes_before: once ? null : step.minutesBefore,
    send_at: step.sendAt === null ? null : wholeSecond(new Date(step.sendAt)),
    enabled: step.enabled,
  };
}

/** The upcoming entries of the alliance being viewed, with their steps: still
 * to start or still open, starting within 14 days, not hidden. */
export function useAlarmEntries() {
  return useQuery({
    queryKey: [...KEY, 'entries'],
    queryFn: async (): Promise<AlarmEntry[]> => {
      const now = new Date();
      const nowIso = now.toISOString();
      const { data, error } = await supabase
        .from('schedule_events')
        .select(
          'schedule_event_id, title, category, starts_at, ends_at, source, source_key, alarm_message, schedule_reminders(reminder_id, anchor, minutes_before, send_at, enabled)',
        )
        .eq('hidden', false)
        .lt('starts_at', new Date(now.getTime() + AHEAD_MS).toISOString())
        .or(`starts_at.gte.${nowIso},ends_at.gte.${nowIso}`)
        .order('starts_at');
      throwIf(error);
      return (data ?? []).map((row) => ({
        id: row.schedule_event_id,
        title: row.title,
        category: row.category,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        source: row.source,
        sourceKey: row.source_key,
        alarmMessage: row.alarm_message,
        steps: orderSteps(row.schedule_reminders.map(toStep)),
      }));
    },
  });
}

export function useAlarmBoards() {
  return useQuery({
    queryKey: [...KEY, 'boards'],
    queryFn: async (): Promise<AlarmBoard[]> => {
      const { data, error } = await supabase
        .from('schedule_categories')
        .select(
          'category, label, kind, channel, ping_role_id, start_reminders, close_reminders, alarm_on_open, message_template, activity_id, activity_stage, sort_order',
        )
        .order('sort_order')
        .order('label');
      throwIf(error);
      return (data ?? []).map((row) => ({
        category: row.category,
        label: row.label,
        kind: row.kind === 'window' ? 'window' : 'point',
        channel: row.channel,
        pingRoleId: row.ping_role_id,
        startReminders: row.start_reminders,
        closeReminders: row.close_reminders,
        alarmOnOpen: row.alarm_on_open,
        messageTemplate: row.message_template,
        activityId: row.activity_id,
        activityStage: row.activity_stage,
        sortOrder: row.sort_order,
      }));
    },
  });
}

/** What the minute job has queued for these entries, by entry id (0324).
 *  Polled: nothing pushes these tables to the page, and a chip still reading
 *  "pending" after its alarm went out is the stale state this avoids. */
export function useAlarmDeliveries(eventIds: readonly string[]) {
  const ids = [...eventIds].sort();
  return useQuery({
    queryKey: [...KEY, 'deliveries', ids],
    enabled: ids.length > 0,
    refetchInterval: DELIVERIES_POLL_MS,
    queryFn: async (): Promise<Record<string, Delivery[]>> => {
      const { data, error } = await supabase.rpc('alarm_deliveries', { p_events: ids });
      throwIf(error);
      const byEntry: Record<string, Delivery[]> = {};
      for (const row of data ?? []) {
        byEntry[row.schedule_event_id] = [
          ...(byEntry[row.schedule_event_id] ?? []),
          // Typed non-null by the generator; a row still queued has neither.
          {
            alarmStep: row.alarm_step,
            anchorAt: row.anchor_at,
            deliveredAt: row.delivered_at ?? null,
            expiredAt: row.expired_at ?? null,
          },
        ];
      }
      return byEntry;
    },
  });
}

export interface GameEvent {
  activityId: string;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** The game's calendar for one server: what "watch a game event" offers. */
export function useGameEventsForServer(serverId: number) {
  return useQuery({
    queryKey: [...KEY, 'game-events', serverId],
    enabled: serverId > 0,
    queryFn: async (): Promise<GameEvent[]> => {
      const { data, error } = await supabase
        .from('event_schedule_current')
        .select('activity_id, name, starts_at, ends_at')
        .eq('server_id', serverId)
        .order('starts_at');
      throwIf(error);
      return (data ?? []).flatMap(({ activity_id, name, starts_at, ends_at }) =>
        activity_id === null
          ? []
          : [{ activityId: activity_id, name, startsAt: starts_at, endsAt: ends_at }],
      );
    },
  });
}

/** The alliance's `schedule_reminder` routing — the fallback channel an alarm
 *  takes when its board has none. Raw, for `nothingWillBeSent` to judge. */
export function useReminderRouting() {
  return useQuery({
    queryKey: [...KEY, 'reminder-routing'],
    queryFn: async (): Promise<unknown> => {
      const value = await fetchAllianceSetting('discord_notifications');
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
      }
      return value.schedule_reminder ?? null;
    },
  });
}

export interface UnplacedPick {
  id: string;
  eventKey: string;
  slot: number;
  startsAt: string;
  endsAt: string | null;
  capturedAt: string;
  serverId: number;
}

/** Picks of the last 14 days that 0249 could not tie to an alliance, read on
 * the server of the alliance on screen.
 *
 * FILTERED IN THE QUERY. The table is readable across the group and PostgREST
 * stops at 1,000 rows, so filtering afterwards could find nothing for this
 * server under other servers' rows. `serverId` null (not known yet): all of
 * them, as before the server was known.
 */
export function useUnplacedPicks(serverId: number | null) {
  return useQuery({
    queryKey: [...KEY, 'unplaced-picks', serverId],
    queryFn: async (): Promise<UnplacedPick[]> => {
      let query = supabase
        .from('alliance_event_times')
        .select(
          'snapshot_id, event_key, slot, starts_at, ends_at, captured_at, collected_from_server_id',
        )
        .is('alliance_id', null)
        .gte('captured_at', new Date(Date.now() - AHEAD_MS).toISOString());
      if (serverId !== null) {
        query = query.eq('collected_from_server_id', serverId);
      }
      const { data, error } = await query.order('captured_at', { ascending: false });
      throwIf(error);
      return (data ?? []).map((row) => ({
        id: row.snapshot_id,
        eventKey: row.event_key,
        slot: row.slot,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        capturedAt: row.captured_at,
        serverId: row.collected_from_server_id,
      }));
    },
  });
}

export interface EntryAlarmsDraft {
  entryId: string;
  /** The message as the officer edited it; null when it was not touched. */
  message: string | null;
  current: readonly AlarmStep[];
  desired: readonly AlarmStep[];
}

/** An entry's message and steps, saved as a DIFF (spec §1): unchanged rows
 * keep their ids, and only steps no longer wanted are deleted.
 *
 * THE MESSAGE IS WRITTEN ONLY WHEN IT WAS EDITED. The page's copy can be hours
 * old (nothing refetches it on focus, and no realtime topic carries these
 * tables), so writing it back with a step change would put back a message
 * another officer has replaced since.
 */
export function useSaveEntryAlarms() {
  return useAlarmMutation(async (draft: EntryAlarmsDraft) => {
    if (draft.message !== null) {
      const message = draft.message.trim();
      const saved = await supabase
        .from('schedule_events')
        .update({ alarm_message: message === '' ? null : message })
        .eq('schedule_event_id', draft.entryId);
      throwIf(saved.error);
    }
    const diff = reminderDiff(draft.current, draft.desired);
    if (diff.remove.length > 0) {
      const removed = await supabase
        .from('schedule_reminders')
        .delete()
        .eq('schedule_event_id', draft.entryId)
        .in('reminder_id', diff.remove);
      throwIf(removed.error);
    }
    const updated = await Promise.all(
      diff.update.map((step) =>
        supabase
          .from('schedule_reminders')
          .update({ enabled: step.enabled })
          .eq('schedule_event_id', draft.entryId)
          // Always a current row's id: reminderDiff matched it by key.
          .eq('reminder_id', step.reminderId ?? ''),
      ),
    );
    throwIf(updated.find((result) => result.error !== null)?.error ?? null);
    if (diff.insert.length > 0) {
      const inserted = await supabase
        .from('schedule_reminders')
        .insert(diff.insert.map((step) => reminderRow(draft.entryId, step)));
      throwIf(inserted.error);
    }
  });
}

/** Send now (no `at`) or later. It carries the entry's SAVED message, so save
 *  that first. A time already past is refused: the job would never send it. */
export function useSendOnce() {
  return useAlarmMutation(async ({ entryId, at }: { entryId: string; at?: Date }) => {
    const now = new Date();
    const when = at ?? now;
    if (when.getTime() < now.getTime() - 60_000) {
      throw new Error('That time has already passed.');
    }
    const { error } = await supabase
      .from('schedule_reminders')
      .insert({ schedule_event_id: entryId, anchor: 'start', send_at: wholeSecond(when) });
    throwIf(error);
  });
}

/** Off the tab. A captured entry is HIDDEN, not deleted: the game would only
 *  write it again on the next reading. A manual one is deleted. */
export function useHideEntry() {
  return useAlarmMutation(async (entry: Pick<AlarmEntry, 'id' | 'source'>) => {
    const { error } =
      entry.source === 'manual'
        ? await supabase.from('schedule_events').delete().eq('schedule_event_id', entry.id)
        : await supabase
            .from('schedule_events')
            .update({ hidden: true })
            .eq('schedule_event_id', entry.id);
    throwIf(error);
  });
}

export type BoardDraft = Omit<AlarmBoard, 'label' | 'activityId' | 'activityStage' | 'sortOrder'>;

/** A board's alarm settings. Entries already filed keep their steps (0322
 *  copies them at filing); only entries filed afterwards get the new ones. */
export function useSaveBoard() {
  return useAlarmMutation(async (draft: BoardDraft) => {
    const template = draft.messageTemplate?.trim() ?? '';
    const { error } = await supabase
      .from('schedule_categories')
      .update({
        kind: draft.kind,
        channel: draft.channel === '' ? null : draft.channel,
        ping_role_id: pingRole(draft.pingRoleId),
        start_reminders: stepMinutes(draft.startReminders),
        close_reminders: stepMinutes(draft.closeReminders),
        alarm_on_open: draft.alarmOnOpen,
        message_template: template === '' ? null : template,
      })
      .eq('category', draft.category);
    throwIf(error);
  });
}

/** "Use for every board": the ping role ALONE on the boards named, in one
 *  statement. Never a whole-board save from this page's copy, which would put
 *  back whatever another officer changed on those boards since it loaded. */
export function useSavePingRole() {
  return useAlarmMutation(
    async ({ pingRoleId, categories }: { pingRoleId: string | null; categories: string[] }) => {
      if (categories.length === 0) {
        return;
      }
      const { error } = await supabase
        .from('schedule_categories')
        .update({ ping_role_id: pingRole(pingRoleId) })
        .in('category', categories);
      throwIf(error);
    },
  );
}

/** A window board following one game activity: 0325 then files its windows.
 *  Inserted, never upserted, so an existing board is not overwritten. */
export function useWatchGameEvent() {
  return useAlarmMutation(async ({ activityId, name }: { activityId: string; name: string }) => {
    const { error } = await supabase.from('schedule_categories').insert({
      category: `game_${activityId.replace(/[^A-Za-z0-9]+/g, '_')}`,
      label: name.trim() === '' ? `Event ${activityId}` : name.trim(),
      kind: 'window',
      start_reminders: [],
      activity_id: activityId,
      sort_order: 100,
    });
    if (error?.code === '23505') {
      throw new Error('That game event already has a board.');
    }
    throwIf(error);
  });
}

/** A board of the alliance's own: a name and a kind. The key is derived from
 * the name, free among `taken` (the alliance's boards). Its steps, channel and
 * template are the column defaults (0322) — except that those defaults count
 * down to a START whatever the kind, and a window opens rather than starts, so
 * a window board is given no start steps, as 0322's seeded windows are. */
export function useCreateBoard() {
  return useAlarmMutation(
    async ({
      label,
      kind,
      taken,
    }: { label: string; kind: AlarmBoard['kind']; taken: string[] }) => {
      const name = label.trim();
      if (name === '') {
        throw new Error('A board needs a name.');
      }
      const { error } = await supabase.from('schedule_categories').insert({
        category: categoryKey(name, taken),
        label: name,
        kind,
        ...(kind === 'window' ? { start_reminders: [] } : {}),
      });
      if (error?.code === '23505') {
        throw new Error('Another officer just added a board with that name. Try again.');
      }
      throwIf(error);
    },
  );
}

/** A board removed. Its entries stay, with their alarms (0203 clears their
 *  board), and a watched game event is un-watched this way (0325 files
 *  nothing for an activity no board follows). */
export function useDeleteBoard() {
  return useAlarmMutation(async (category: string) => {
    const { error } = await supabase.from('schedule_categories').delete().eq('category', category);
    throwIf(error);
  });
}

/** A manual entry — how Server Clash is covered until the game lists it. The
 *  board's steps are added by 0322's trigger, not here. Returns its id. */
export function useAddEntry() {
  return useAlarmMutation(async (draft: EntryTimesDraft & { category: string | null }) => {
    const { data, error } = await supabase
      .from('schedule_events')
      .insert({
        title: checkEntry(draft),
        category: draft.category,
        starts_at: draft.startsAt,
        ends_at: draft.endsAt,
        source: 'manual',
      })
      .select('schedule_event_id')
      .single();
    throwIf(error);
    return data?.schedule_event_id ?? null;
  });
}

/** A manual entry's title and times. The game owns a captured entry's times
 *  (its next reading puts them back): refused here, and again in the WHERE. */
export function useEditEntry() {
  return useAlarmMutation(
    async (draft: EntryTimesDraft & { entry: Pick<AlarmEntry, 'id' | 'source'> }) => {
      if (draft.entry.source !== 'manual') {
        throw new Error('Only a manual entry can be edited; the game owns the others.');
      }
      const { error } = await supabase
        .from('schedule_events')
        .update({ title: checkEntry(draft), starts_at: draft.startsAt, ends_at: draft.endsAt })
        .eq('schedule_event_id', draft.entry.id)
        .eq('source', 'manual');
      throwIf(error);
    },
  );
}
