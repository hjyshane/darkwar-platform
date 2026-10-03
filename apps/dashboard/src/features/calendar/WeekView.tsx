// One server week, Monday first, with room to read every bar: each category
// under its own label, nothing folded. The default view.

import { WEEKDAYS, mondayOf } from './MonthView';
import { WeekGrid } from './WeekGrid';
import { type CalendarEvent, addDays } from './data';

function short(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function WeekView({
  events,
  day,
  today,
  onDay,
  onPickDay,
}: {
  events: CalendarEvent[];
  day: string;
  today: string;
  onDay: (day: string) => void;
  onPickDay: (day: string) => void;
}) {
  const monday = mondayOf(day);
  const keys = WEEKDAYS.map((_, index) => addDays(monday, index));
  const sunday = keys[6] ?? monday;

  return (
    <section aria-label="Week">
      <div className="row calendar-month-nav">
        <button onClick={() => onDay(addDays(monday, -7))} type="button">
          ← Previous
        </button>
        <h3 className="calendar-month-title">
          {short(monday)} – {short(sunday)}
        </h3>
        <button onClick={() => onDay(addDays(monday, 7))} type="button">
          Next →
        </button>
        <button onClick={() => onDay(today)} type="button">
          This week
        </button>
      </div>
      <div className="calendar-month">
        <WeekGrid
          days={keys.map((key, index) => ({
            key,
            label: `${WEEKDAYS[index]} ${Number(key.slice(8))}`,
          }))}
          events={events}
          onPickDay={onPickDay}
          tall
          today={today}
        />
      </div>
    </section>
  );
}
