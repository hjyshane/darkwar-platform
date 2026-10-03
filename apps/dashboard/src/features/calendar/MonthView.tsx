// The game calendar as a month, in server days. Each day shows what starts
// and what ends on it; picking a day opens the list filtered to that day.
// Reuses the alliance Schedule's grid (lib/calendar.ts, .schedule-*).

import { useMemo, useState } from 'react';
import { calendarRange, dayKey, isOutsideMonth, rangeLabel, shiftAnchor } from '../../lib/calendar';
import { type CalendarEvent, byServerDay, labelOf, serverDay } from './data';

/** Events listed per cell before "+N more", so a busy Monday stays a cell. */
const PER_CELL = 4;

function Chips({
  events,
  mark,
  title,
}: {
  events: CalendarEvent[];
  mark: string;
  title: string;
}) {
  const shown = events.slice(0, PER_CELL);
  return (
    <>
      {shown.map((event) => (
        <div
          className={`calendar-chip ${event.category === 'shop' ? 'calendar-chip-shop' : ''}`}
          key={`${mark}:${event.activity_id}`}
          title={`${title}: ${labelOf(event)}`}
        >
          <span aria-hidden="true">{mark}</span> {labelOf(event)}
        </div>
      ))}
      {events.length > PER_CELL && (
        <div className="calendar-more">+{events.length - PER_CELL} more</div>
      )}
    </>
  );
}

export function MonthView({
  events,
  now,
  onPickDay,
}: {
  events: CalendarEvent[];
  now: Date;
  onPickDay: (day: string) => void;
}) {
  const today = serverDay(now.toISOString());
  const [anchor, setAnchor] = useState(() => new Date(`${today.slice(0, 8)}01T00:00:00Z`));
  const range = useMemo(() => calendarRange('month', anchor), [anchor]);
  const { starts, ends } = useMemo(() => byServerDay(events), [events]);

  return (
    <section aria-label="Month">
      <div className="row calendar-month-nav">
        <button onClick={() => setAnchor(shiftAnchor('month', anchor, -1))} type="button">
          ← Previous
        </button>
        <h3 className="calendar-month-title">{rangeLabel('month', anchor)}</h3>
        <button onClick={() => setAnchor(shiftAnchor('month', anchor, 1))} type="button">
          Next →
        </button>
      </div>
      <p className="subtle">
        ▶ starts that day, ■ last day. Server days (UTC−2). Pick a day to list everything running on
        it.
      </p>
      <div
        className="schedule-grid schedule-grid-month"
        style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
      >
        {range.days.map((day) => {
          const key = dayKey(day);
          const starting = starts.get(key) ?? [];
          const ending = ends.get(key) ?? [];
          return (
            <button
              aria-label={`${key}: ${starting.length} starting, ${ending.length} ending`}
              className={[
                'schedule-day',
                'calendar-day',
                key === today ? 'schedule-today' : '',
                isOutsideMonth(day, anchor) ? 'schedule-outside' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={key}
              onClick={() => onPickDay(key)}
              type="button"
            >
              <div className="schedule-daylabel">
                <time dateTime={key}>{day.toUTCString().slice(0, 11)}</time>
              </div>
              <Chips events={starting} mark="▶" title="Starts" />
              <Chips events={ending} mark="■" title="Last day" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
