// One week of the calendar: seven server days, every event a bar across the
// days it runs, grouped by category — each category its own lanes, under a
// small label, in the order the filters list them. Nothing is folded away:
// a busy week is simply taller.
//
// A bar that carries on past the week edge is drawn square on that side;
// only a real start or end is rounded.

import {
  CATEGORY_LABELS,
  type CalendarEvent,
  type WeekBar,
  categoryOf,
  groupedWeekBars,
  labelOf,
  serverWhen,
} from './data';

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

export interface WeekDay {
  key: string;
  /** The number or label printed on the day's button. */
  label: string;
  muted?: boolean;
}

export function WeekGrid({
  days,
  events,
  today,
  onPickDay,
  tall = false,
}: {
  days: WeekDay[];
  events: CalendarEvent[];
  today: string;
  onPickDay: (day: string) => void;
  /** The week view: taller day cells, labelled groups. */
  tall?: boolean;
}) {
  const keys = days.map((day) => day.key);
  const groups = groupedWeekBars(events, keys);

  // Row 1 holds the dates. Each group takes a label row (week view only) and
  // its lanes.
  let next = 2;
  const placed = groups.map((group) => {
    const labelRow = tall ? next++ : null;
    const firstLane = next;
    next += group.lanes;
    return { group, labelRow, firstLane };
  });
  const rows = Math.max(next - 1, 1);

  return (
    <div
      className={`calendar-week${tall ? ' calendar-week-tall' : ''}`}
      // The date row is at least 1.6rem and grows with its text: at phone width a
      // day reads "Mon" over "5", two lines, and a fixed row let it run into the
      // label row beneath.
      style={{ gridTemplateRows: `minmax(1.6rem, auto) repeat(${Math.max(rows - 1, 0)}, auto)` }}
    >
      {days.map((day, column) => (
        <div
          className={[
            'calendar-week-day',
            day.key === today ? 'schedule-today' : '',
            day.muted ? 'schedule-outside' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={day.key}
          style={{ gridColumn: column + 1, gridRow: `1 / ${rows + 1}` }}
        >
          <button
            aria-label={`Open ${day.key}`}
            className="calendar-date-button"
            onClick={() => onPickDay(day.key)}
            type="button"
          >
            <time dateTime={day.key}>{day.label}</time>
          </button>
        </div>
      ))}
      {placed.map(({ group, labelRow, firstLane }) => [
        labelRow !== null && (
          <div
            className={`calendar-lane-label calendar-cat-${group.category}`}
            key={`label-${group.category}`}
            style={{ gridColumn: '1 / 8', gridRow: labelRow }}
          >
            {CATEGORY_LABELS[group.category]}
          </div>
        ),
        ...group.bars.map((bar) => (
          <Bar
            bar={bar}
            key={`${group.category}-${bar.event.activity_id}`}
            row={firstLane + bar.lane}
          />
        )),
      ])}
    </div>
  );
}
