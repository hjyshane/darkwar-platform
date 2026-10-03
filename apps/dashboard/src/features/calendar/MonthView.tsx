// The game calendar as a month of server days, each event a bar from the day
// it starts to its last day, coloured by category; the major fights solid.
// A bar that carries on past the week edge is drawn square on that side; only
// a real start or end is rounded.
//
// A busy week shows a few lanes and "+N more", which opens that week in place.
// The date opens the list filtered to that day.

import { useMemo, useState } from 'react';
import { calendarRange, dayKey, isOutsideMonth, rangeLabel, shiftAnchor } from '../../lib/calendar';
import {
  CATEGORY_LABELS,
  type CalendarEvent,
  type Category,
  type WeekBar,
  categoryOf,
  labelOf,
  serverDay,
  serverWhen,
  weekBars,
} from './data';

/** Lanes shown per week before "+N more". */
const LANES = 4;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Bar({ bar, row }: { bar: WeekBar; row: number }) {
  const category = categoryOf(bar.event);
  const classes = [
    'calendar-bar',
    `calendar-cat-${category}`,
    bar.startsHere ? 'calendar-bar-start' : '',
    bar.endsHere ? 'calendar-bar-end' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      style={{ gridColumn: `${bar.start + 1} / ${bar.end + 2}`, gridRow: row }}
      title={`${labelOf(bar.event)} (${CATEGORY_LABELS[category]}): ${serverWhen(bar.event.starts_at)} → ${serverWhen(bar.event.ends_at)}`}
    >
      {!bar.startsHere && <span aria-hidden="true">◀ </span>}
      {labelOf(bar.event)}
    </div>
  );
}

export function MonthView({
  events,
  shown,
  now,
  onPickDay,
}: {
  events: CalendarEvent[];
  shown: ReadonlyArray<Category>;
  now: Date;
  onPickDay: (day: string) => void;
}) {
  const today = serverDay(now.toISOString());
  const [anchor, setAnchor] = useState(() => new Date(`${today.slice(0, 8)}01T00:00:00Z`));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const weeks = useMemo(() => {
    const days = calendarRange('month', anchor).days;
    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      out.push(days.slice(i, i + 7));
    }
    return out;
  }, [anchor]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

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
      <p className="subtle calendar-legend">
        {shown.map((category) => (
          <span
            className={`calendar-bar calendar-cat-${category} calendar-bar-start calendar-bar-end calendar-legend-chip`}
            key={category}
          >
            {CATEGORY_LABELS[category]}
          </span>
        ))}
        Each bar runs from the first to the last server day (UTC−2). Pick a date to list everything
        running on it.
      </p>

      <div className="calendar-month">
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        {weeks.map((week) => {
          const keys = week.map(dayKey);
          const weekKey = keys[0] ?? '';
          const bars = weekBars(events, keys);
          const laneCount = bars.reduce((most, bar) => Math.max(most, bar.lane + 1), 0);
          const open = expanded.has(weekKey);
          const shownLanes = open ? laneCount : Math.min(laneCount, LANES);
          const hidden = bars.filter((bar) => bar.lane >= shownLanes).length;
          const rows = 1 + shownLanes + (laneCount > LANES ? 1 : 0);
          return (
            <div
              className="calendar-week"
              key={weekKey}
              style={{ gridTemplateRows: `1.6rem repeat(${rows - 1}, auto)` }}
            >
              {week.map((day, column) => {
                const key = keys[column] ?? '';
                return (
                  <div
                    className={[
                      'calendar-week-day',
                      key === today ? 'schedule-today' : '',
                      isOutsideMonth(day, anchor) ? 'schedule-outside' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={key}
                    style={{ gridColumn: column + 1, gridRow: `1 / ${rows + 1}` }}
                  >
                    <button
                      aria-label={`List everything running on ${key}`}
                      className="calendar-date-button"
                      onClick={() => onPickDay(key)}
                      type="button"
                    >
                      <time dateTime={key}>{day.getUTCDate()}</time>
                    </button>
                  </div>
                );
              })}
              {bars
                .filter((bar) => bar.lane < shownLanes)
                .map((bar) => (
                  <Bar bar={bar} key={bar.event.activity_id} row={bar.lane + 2} />
                ))}
              {laneCount > LANES && (
                <button
                  aria-expanded={open}
                  className="calendar-more"
                  onClick={() => toggle(weekKey)}
                  style={{ gridColumn: '1 / 8', gridRow: rows }}
                  type="button"
                >
                  {open ? 'Show less' : `+${hidden} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
