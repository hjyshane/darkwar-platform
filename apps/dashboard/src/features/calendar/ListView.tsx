// The game calendar as a list: search by name, by server day, or both.
// With no day picked it keeps the running / coming / ended sections; with a
// day picked it is one list of everything running on that day.

import { useMemo } from 'react';
import { EventName } from './EventName';
import {
  type Bucket,
  type CalendarEvent,
  type Category,
  arrange,
  inCategory,
  serverWhen,
  until,
} from './data';

const SECTIONS: ReadonlyArray<{ bucket: Bucket; title: string; blurb: string; open: boolean }> = [
  { bucket: 'live', title: 'Running now', blurb: 'Soonest to end first.', open: true },
  { bucket: 'upcoming', title: 'Coming up', blurb: 'Soonest to start first.', open: true },
  {
    bucket: 'ended',
    title: 'Just ended',
    blurb: 'Still on the calendar the server sent, already over.',
    open: false,
  },
  {
    bucket: 'standing',
    title: 'Standing features',
    blurb: 'Run for half a year or more — part of the game rather than an event.',
    open: false,
  },
  {
    bucket: 'untimed',
    title: 'No dates',
    blurb: 'Listed by the server without a start or end.',
    open: false,
  },
];

function EventTable({
  events,
  countdown,
  now,
  mayName,
}: {
  events: CalendarEvent[];
  countdown: 'start' | 'end' | null;
  now: Date;
  mayName: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Starts</th>
            <th scope="col">Ends</th>
            {countdown !== null && (
              <th className="num" scope="col">
                {countdown === 'end' ? 'Ends in' : 'Starts in'}
              </th>
            )}
            <th className="num" scope="col" title="HQ level the event needs">
              HQ
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={`${event.server_id}:${event.activity_id}`}>
              <td>
                <EventName event={event} mayName={mayName} />
              </td>
              <td>{serverWhen(event.starts_at, now)}</td>
              <td>{serverWhen(event.ends_at, now)}</td>
              {countdown !== null && (
                <td className="num">
                  {(() => {
                    const at = countdown === 'end' ? event.ends_at : event.starts_at;
                    return at === null ? '—' : until(at, now);
                  })()}
                </td>
              )}
              <td className="num">{event.need_hq_level ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One category's events: the day table when a day is picked, otherwise the
 * running / coming / ended sections. */
function CategoryList({
  events,
  day,
  now,
  mayName,
}: {
  events: CalendarEvent[];
  day: string;
  now: Date;
  mayName: boolean;
}) {
  const arranged = useMemo(() => arrange(events, now), [events, now]);
  if (day !== '') {
    return <EventTable countdown={null} events={events} mayName={mayName} now={now} />;
  }
  return (
    <>
      {SECTIONS.map(({ bucket, title, blurb, open }) => {
        const list = arranged[bucket];
        if (list.length === 0) {
          return null;
        }
        return (
          <details className="calendar-section" key={bucket} open={open}>
            <summary>
              <h4 className="calendar-heading">
                {title} <span className="calendar-count">({list.length})</span>
              </h4>
            </summary>
            <p className="subtle">{blurb}</p>
            <EventTable
              countdown={bucket === 'live' ? 'end' : bucket === 'upcoming' ? 'start' : null}
              events={list}
              mayName={mayName}
              now={now}
            />
          </details>
        );
      })}
    </>
  );
}

const GROUPS: ReadonlyArray<{ category: Category; title: string }> = [
  { category: 'event', title: 'Events' },
  { category: 'shop', title: 'Shop & passes' },
];

/** The list, one group per category, each in its own colour. Unclassified
 * entries sit with the events (inCategory). */
export function ListView({
  events,
  day,
  now,
  mayName,
}: {
  events: CalendarEvent[];
  day: string;
  now: Date;
  mayName: boolean;
}) {
  if (events.length === 0) {
    return <p className="empty">Nothing matches. Clear the search or pick another day.</p>;
  }
  return (
    <>
      {day !== '' && <h3>Running on {day}</h3>}
      {GROUPS.map(({ category, title }) => {
        const list = events.filter((event) => inCategory(event, category));
        if (list.length === 0) {
          return null;
        }
        return (
          <section
            aria-label={title}
            className={`calendar-group calendar-group-${category}`}
            key={category}
          >
            <h3 className="calendar-group-title">
              {title} <span className="calendar-count">({list.length})</span>
            </h3>
            <CategoryList day={day} events={list} mayName={mayName} now={now} />
          </section>
        );
      })}
    </>
  );
}
