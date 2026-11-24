// The game calendar as a list: search by name, by server day, or both.
// With no day picked it keeps the running / coming / ended sections; with a
// day picked it is one list of everything running on that day.

import { useMemo } from 'react';
import { type Translate, useT } from '../../lib/i18n';
import { EventName } from './EventName';
import { useCalendarConfig } from './categories';
import { type Bucket, type CalendarEvent, arrange, categoryOf, serverWhen, until } from './data';

const sections = (
  t: Translate,
): ReadonlyArray<{ bucket: Bucket; title: string; blurb: string; open: boolean }> => [
  { bucket: 'live', title: t('Running now'), blurb: t('Soonest to end first.'), open: true },
  { bucket: 'upcoming', title: t('Coming up'), blurb: t('Soonest to start first.'), open: true },
  {
    bucket: 'ended',
    title: t('Just ended'),
    blurb: t('Still on the calendar the server sent, already over.'),
    open: false,
  },
  {
    bucket: 'standing',
    title: t('Standing features'),
    blurb: t('Run for half a year or more — part of the game rather than an event.'),
    open: false,
  },
  {
    bucket: 'untimed',
    title: t('No dates'),
    blurb: t('Listed by the server without a start or end.'),
    open: false,
  },
];

export function EventTable({
  events,
  countdown,
  now,
  mayName,
  onOpen,
}: {
  events: CalendarEvent[];
  countdown: 'start' | 'end' | null;
  now: Date;
  mayName: boolean;
  onOpen: (event: CalendarEvent) => void;
}) {
  const t = useT();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('Event')}</th>
            <th scope="col">{t('Starts')}</th>
            <th scope="col">{t('Ends')}</th>
            {countdown !== null && (
              <th className="num" scope="col">
                {countdown === 'end' ? t('Ends in') : t('Starts in')}
              </th>
            )}
            <th className="num" scope="col" title={t('HQ level the event needs')}>
              {t('HQ')}
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={`${event.server_id}:${event.activity_id}`}>
              <td>
                <EventName event={event} mayName={mayName} onOpen={onOpen} />
              </td>
              <td>{serverWhen(event.starts_at, now)}</td>
              <td>{serverWhen(event.ends_at, now)}</td>
              {countdown !== null && (
                <td className="num">
                  {(() => {
                    const at = countdown === 'end' ? event.ends_at : event.starts_at;
                    return at === null ? '—' : until(at, now, t);
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
  onOpen,
}: {
  events: CalendarEvent[];
  day: string;
  now: Date;
  mayName: boolean;
  onOpen: (event: CalendarEvent) => void;
}) {
  const t = useT();
  const { standingMs } = useCalendarConfig();
  const arranged = useMemo(() => arrange(events, now, standingMs), [events, now, standingMs]);
  if (day !== '') {
    return (
      <EventTable countdown={null} events={events} mayName={mayName} now={now} onOpen={onOpen} />
    );
  }
  return (
    <>
      {sections(t).map(({ bucket, title, blurb, open }) => {
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
              onOpen={onOpen}
            />
          </details>
        );
      })}
    </>
  );
}

/** The list, one group per category, each in its own colour. A named entry
 * with no category sits with the events (categoryOf); an unnamed one never
 * reaches here (CalendarPage lists those apart). */
export function ListView({
  events,
  day,
  now,
  mayName,
  onOpen,
}: {
  events: CalendarEvent[];
  day: string;
  now: Date;
  mayName: boolean;
  onOpen: (event: CalendarEvent) => void;
}) {
  const t = useT();
  const config = useCalendarConfig();
  if (events.length === 0) {
    return <p className="empty">{t('Nothing matches. Clear the search or pick another day.')}</p>;
  }
  return (
    <>
      {day !== '' && <h3>{t('Running on {day}', { day })}</h3>}
      {config.visible.map(({ key: category }) => {
        const title = config.label(category, t);
        const list = events.filter((event) => categoryOf(event, config.knownKeys) === category);
        if (list.length === 0) {
          return null;
        }
        return (
          <section
            aria-label={title}
            className={`calendar-group ${config.className(category)}`}
            key={category}
          >
            <h3 className="calendar-group-title">
              {title} <span className="calendar-count">({list.length})</span>
            </h3>
            <CategoryList day={day} events={list} mayName={mayName} now={now} onOpen={onOpen} />
          </section>
        );
      })}
    </>
  );
}
