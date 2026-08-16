import { useMemo, useState } from 'react';
import {
  CALENDAR_VIEWS,
  type CalendarView,
  calendarRange,
  dayKey,
  isOutsideMonth,
  rangeLabel,
  shiftAnchor,
} from '../../lib/calendar';
import { isAllowed, usePermissions } from '../../lib/permissions';
import {
  readZone,
  storeZone,
  zoneLabel,
  zoneOptions,
  zonedDayKey,
  zonedTime,
} from '../../lib/timezone';
import { useSession } from '../../lib/useSession';
import { ScheduleBoards } from './ScheduleBoards';
import { ScheduleEditor, reminderLabel } from './ScheduleEditor';
import {
  type ScheduleDraft,
  type ScheduleEvent,
  daysCovered,
  toLocal,
  useDeleteScheduleEvent,
  useSaveScheduleEvent,
  useScheduleCategories,
  useScheduleEvents,
} from './schedule';

/** The alliance calendar.
 *
 * WEEK IS THE DEFAULT, and the four views are not four screens: they are the
 * same grid over a different range, which is why `calendar.ts` returns days and
 * this file only draws them. A day view is a grid of one.
 *
 * Everything is UTC and says so. Members read this from four time zones and the
 * game's clock is UTC; rendering in the reader's zone would put the same bear
 * hunt on two different days depending on who asked.
 */

const EMPTY: ScheduleDraft = {
  title: '',
  body: '',
  category: '',
  starts_at: '',
  ends_at: '',
  reminders: [],
};

/** Draws in the reader's zone, so an entry stored at 20:00 UTC reads 05:00 to
 *  somebody in Seoul — and, because `zonedDayKey` buckets the cells the same
 *  way, reads it on the day they would call it. */
function timeOf(iso: string, zone: string): string {
  return zonedTime(iso, zone);
}

function draftFrom(event: ScheduleEvent, zone: string): ScheduleDraft {
  return {
    schedule_event_id: event.schedule_event_id,
    title: event.title,
    body: event.body ?? '',
    category: event.category ?? '',
    starts_at: toLocal(event.starts_at, zone),
    ends_at: toLocal(event.ends_at, zone),
    reminders: event.schedule_reminders.map((entry) => entry.minutes_before).sort((a, b) => a - b),
  };
}

export function SchedulePanel() {
  const [view, setView] = useState<CalendarView>('week');
  // Held as a UTC-midnight Date because that is what `calendarRange` steps
  // through; it is a DATE LABEL rather than an instant, so no zone applies.
  const [anchor, setAnchor] = useState<Date>(
    () => new Date(`${zonedDayKey(new Date().toISOString(), readZone())}T00:00:00Z`),
  );
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [boards, setBoards] = useState(false);
  // Per browser, not per account: the same person wants a different answer on a
  // laptop at home and a phone abroad.
  const [zone, setZone] = useState<string>(() => readZone());

  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayManage = isAllowed(permissions?.grants, session?.role, 'schedule.manage');

  const range = useMemo(() => calendarRange(view, anchor), [view, anchor]);
  const { data: events, isPending, error } = useScheduleEvents(range);
  const { data: categories } = useScheduleCategories();
  const save = useSaveScheduleEvent(zone);
  const remove = useDeleteScheduleEvent();

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of events ?? []) {
      for (const key of daysCovered(event, zone)) {
        const bucket = map.get(key);
        if (bucket === undefined) {
          map.set(key, [event]);
        } else {
          bucket.push(event);
        }
      }
    }
    return map;
  }, [events, zone]);

  const colours = useMemo(
    () => new Map((categories ?? []).map((entry) => [entry.category, entry.colour])),
    [categories],
  );

  // Today in the READER'S zone, which is what "Today" and the highlighted cell
  // have to mean. `dayKey(new Date())` is today in UTC and is a different day
  // for nine hours out of every twenty-four in Seoul.
  const today = zonedDayKey(new Date().toISOString(), zone);

  return (
    <section aria-labelledby="schedule-heading">
      <h2 id="schedule-heading">Schedule</h2>

      <div className="toolbar schedule-toolbar">
        <nav aria-label="Calendar range" className="tabs subtabs">
          {CALENDAR_VIEWS.map((entry) => (
            <button
              aria-current={entry.view === view ? 'page' : undefined}
              className="tab"
              key={entry.view}
              onClick={() => setView(entry.view)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="schedule-nav">
          <button
            aria-label="Earlier"
            onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
            type="button"
          >
            ‹
          </button>
          <button onClick={() => setAnchor(new Date(`${today}T00:00:00Z`))} type="button">
            Today
          </button>
          <button
            aria-label="Later"
            onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
            type="button"
          >
            ›
          </button>
        </div>
        <span className="count">{rangeLabel(view, anchor)}</span>
        <label className="schedule-zone">
          <span className="visually-hidden">Select your time zone</span>
          <select
            onChange={(e) => {
              setZone(e.target.value);
              storeZone(e.target.value);
            }}
            value={zone}
          >
            {zoneOptions(zone).map((name) => (
              <option key={name} value={name}>
                {zoneLabel(name)}
              </option>
            ))}
          </select>
        </label>
        {mayManage && (
          <>
            <button
              onClick={() => {
                setOpen(null);
                setBoards(false);
                setDraft({ ...EMPTY, starts_at: `${dayKey(range.days[0] ?? new Date())}T20:00` });
              }}
              type="button"
            >
              New entry
            </button>
            <button
              aria-expanded={boards}
              onClick={() => {
                setDraft(null);
                setBoards(!boards);
              }}
              type="button"
            >
              Boards
            </button>
          </>
        )}
      </div>

      {boards && mayManage && <ScheduleBoards categories={categories ?? []} />}

      {draft !== null && (
        <ScheduleEditor
          categories={categories ?? []}
          draft={draft}
          error={save.error === null ? null : (save.error as Error).message}
          zone={zone}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onDelete={
            draft.schedule_event_id === undefined
              ? undefined
              : () => {
                  remove.mutate(draft.schedule_event_id as string);
                  setDraft(null);
                }
          }
          onSave={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
          saving={save.isPending}
        />
      )}

      {error !== null && <p className="error">The calendar could not be read.</p>}
      {isPending && <p className="empty">Loading…</p>}

      <div
        className={`schedule-grid schedule-grid-${view}`}
        // A day view is one column; everything else is a week wide. Inline
        // because it is the one value the CSS cannot know.
        style={{ gridTemplateColumns: `repeat(${view === 'day' ? 1 : 7}, minmax(0, 1fr))` }}
      >
        {range.days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          return (
            <div
              className={[
                'schedule-day',
                key === today ? 'schedule-today' : '',
                view === 'month' && isOutsideMonth(day, anchor) ? 'schedule-outside' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={key}
            >
              <div className="schedule-daylabel">
                <time dateTime={key}>{day.toUTCString().slice(0, 11)}</time>
              </div>
              {entries.map((event) => {
                const colour = colours.get(event.category ?? '') ?? null;
                return (
                  <div className="schedule-entry" key={`${key}:${event.schedule_event_id}`}>
                    <button
                      className="schedule-entry-button"
                      onClick={() =>
                        setOpen(open === event.schedule_event_id ? null : event.schedule_event_id)
                      }
                      style={colour === null ? undefined : { borderLeftColor: colour }}
                      type="button"
                    >
                      <span className="schedule-time">{timeOf(event.starts_at, zone)}</span>{' '}
                      <span className="schedule-title">{event.title}</span>
                    </button>
                    {open === event.schedule_event_id && (
                      <div className="schedule-detail">
                        <p>
                          {timeOf(event.starts_at, zone)}
                          {event.ends_at === null ? '' : ` – ${timeOf(event.ends_at, zone)}`}
                        </p>
                        {event.body !== null && <p>{event.body}</p>}
                        <p className="hint">
                          {event.schedule_reminders.length === 0
                            ? 'No reminder.'
                            : `Reminds: ${event.schedule_reminders
                                .map((entry) => reminderLabel(entry.minutes_before))
                                .join(', ')} before.`}
                        </p>
                        {mayManage && (
                          <button
                            className="linklike"
                            onClick={() => {
                              setOpen(null);
                              setDraft(draftFrom(event, zone));
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {!isPending && (events ?? []).length === 0 && (
        <p className="empty">Nothing on the calendar for this range.</p>
      )}
    </section>
  );
}
