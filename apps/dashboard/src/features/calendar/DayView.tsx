// One server day. On top, everything running that day, grouped by category —
// the all-day row. Below, the day in six four-hour blocks from server
// midnight, the rhythm Survival Preparedness turns over on: each block names
// its Survival Preparedness theme (the weekday order is still to be entered)
// and lists the events that start or end inside it.

import {
  CATEGORIES,
  CATEGORY_LABELS,
  type CalendarEvent,
  addDays,
  categoryOf,
  changesIn,
  dayBlocks,
  labelOf,
  runsOn,
  serverWhen,
} from './data';

/** Survival Preparedness themes per block, by weekday (1 = Monday). Empty
 * until the order is entered; the block then reads "to be added". */
export const PREP_ROTATION: Partial<Record<number, readonly string[]>> = {};

function clock(iso: string): string {
  return serverWhen(iso).split(' · ')[1] ?? '';
}

function weekdayOf(day: string): number {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function DayView({
  events,
  day,
  today,
  now,
  onDay,
}: {
  events: CalendarEvent[];
  day: string;
  today: string;
  now: Date;
  onDay: (day: string) => void;
}) {
  const running = events.filter((event) => runsOn(event, day));
  const blocks = dayBlocks(day);
  const rotation = PREP_ROTATION[weekdayOf(day)];
  const title = new Date(`${day}T00:00:00Z`).toLocaleString('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <section aria-label="Day">
      <div className="row calendar-month-nav">
        <button onClick={() => onDay(addDays(day, -1))} type="button">
          ← Previous
        </button>
        <h3 className="calendar-month-title">{title}</h3>
        <button onClick={() => onDay(addDays(day, 1))} type="button">
          Next →
        </button>
        <button onClick={() => onDay(today)} type="button">
          Today
        </button>
      </div>

      <h4 className="calendar-heading">All day</h4>
      {running.length === 0 ? (
        <p className="empty">Nothing on the calendar for this day.</p>
      ) : (
        <div className="calendar-allday">
          {CATEGORIES.map((category) => {
            const list = running.filter((event) => categoryOf(event) === category);
            if (list.length === 0) {
              return null;
            }
            return (
              <div className={`calendar-allday-group calendar-cat-${category}`} key={category}>
                <div className="calendar-lane-label">{CATEGORY_LABELS[category]}</div>
                <ul className="calendar-chips">
                  {list.map((event) => (
                    <li
                      className={`calendar-bar calendar-bar-start calendar-bar-end calendar-cat-${category}`}
                      key={event.activity_id}
                      title={`${serverWhen(event.starts_at, now)} → ${serverWhen(event.ends_at, now)}`}
                    >
                      {labelOf(event)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <h4 className="calendar-heading">Every four hours</h4>
      <p className="subtle">
        Survival Preparedness turns over at server midnight and every four hours after. Each block
        lists what starts or ends in it.
      </p>
      <ol className="calendar-blocks">
        {blocks.map((block) => {
          const current =
            Date.parse(block.from) <= now.getTime() && now.getTime() < Date.parse(block.to);
          const changes = changesIn(events, block.from, block.to);
          return (
            <li
              aria-current={current ? 'time' : undefined}
              className={`calendar-block${current ? ' calendar-block-now' : ''}`}
              key={block.index}
            >
              <div className="calendar-block-time">
                {clock(block.from)}–{block.index === 5 ? '24:00' : clock(block.to)}
              </div>
              <div className="calendar-block-prep">
                <span className="muted">Survival Preparedness:</span>{' '}
                {rotation?.[block.index] ?? <span className="muted">to be added</span>}
              </div>
              {changes.length > 0 && (
                <ul className="calendar-block-changes">
                  {changes.map(({ event, edge }) => (
                    <li key={`${edge}-${event.activity_id}`}>
                      <span className={`calendar-tag calendar-cat-${categoryOf(event)}`}>
                        {edge === 'starts' ? 'starts' : 'ends'}{' '}
                        {clock((edge === 'starts' ? event.starts_at : event.ends_at) ?? '')}
                      </span>{' '}
                      {labelOf(event)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
