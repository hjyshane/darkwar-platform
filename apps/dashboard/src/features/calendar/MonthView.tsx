// The game calendar as a month of server days: each week a WeekGrid, every
// event a bar coloured by category, the major fights solid. A date opens that
// day's view.

import { calendarRange, dayKey, isOutsideMonth, rangeLabel } from '../../lib/calendar';
import { WeekGrid } from './WeekGrid';
import { type CalendarEvent, addDays } from './data';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView({
  events,
  day,
  today,
  onDay,
  onPickDay,
}: {
  events: CalendarEvent[];
  /** Any server day in the month shown (`YYYY-MM-DD`). */
  day: string;
  today: string;
  onDay: (day: string) => void;
  onPickDay: (day: string) => void;
}) {
  const anchor = new Date(`${day.slice(0, 8)}01T00:00:00Z`);
  const days = calendarRange('month', anchor).days;
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  const shiftMonth = (by: number) => {
    const next = new Date(anchor);
    next.setUTCMonth(next.getUTCMonth() + by);
    onDay(dayKey(next));
  };

  return (
    <section aria-label="Month">
      <div className="row calendar-month-nav">
        <button onClick={() => shiftMonth(-1)} type="button">
          ← Previous
        </button>
        <h3 className="calendar-month-title">{rangeLabel('month', anchor)}</h3>
        <button onClick={() => shiftMonth(1)} type="button">
          Next →
        </button>
        <button onClick={() => onDay(today)} type="button">
          Today
        </button>
      </div>
      <div className="calendar-month">
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        {weeks.map((week) => (
          <WeekGrid
            days={week.map((date) => ({
              key: dayKey(date),
              label: String(date.getUTCDate()),
              muted: isOutsideMonth(date, anchor),
            }))}
            events={events}
            key={dayKey(week[0] ?? anchor)}
            onPickDay={onPickDay}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

/** The Monday of the server week holding `day`. */
export function mondayOf(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}
