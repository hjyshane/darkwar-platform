// The game's own event calendar, as the server sent it with the last login
// the collector saw (0208). Not the alliance's schedule boards — those are
// what officers plan; this is what the game has announced.
//
// The game names nothing. An event shows as "Event #41101" until an officer
// or admin names it here, and from then on everybody sees the name.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSession } from '../../lib/useSession';
import {
  type Bucket,
  type CalendarEvent,
  arrange,
  fetchCalendar,
  labelOf,
  saveEventName,
  until,
} from './data';

/** The calendar changes when somebody logs in, not by the minute. */
const STALE_TIME = 5 * 60_000;

const WHEN = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function when(iso: string | null): string {
  return iso === null ? '—' : WHEN.format(new Date(iso));
}

function NameCell({ event, mayName }: { event: CalendarEvent; mayName: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: string) => saveEventName(event.activity_id, name),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['event-calendar'] });
    },
  });

  if (draft === null) {
    return (
      <td>
        <span className={event.name === null ? 'calendar-unnamed' : undefined}>
          {labelOf(event)}
        </span>
        {mayName && (
          <button
            aria-label={`Name ${labelOf(event)}`}
            className="calendar-name-button"
            onClick={() => setDraft(event.name ?? '')}
            type="button"
          >
            {event.name === null ? 'Name it' : 'Rename'}
          </button>
        )}
      </td>
    );
  }
  return (
    <td>
      <form
        className="row"
        onSubmit={(submit) => {
          submit.preventDefault();
          save.mutate(draft);
        }}
      >
        <input
          aria-label={`Name for event ${event.activity_id}`}
          maxLength={80}
          onChange={(change) => setDraft(change.target.value)}
          placeholder={`Event #${event.activity_id}`}
          value={draft}
        />
        <button disabled={save.isPending} type="submit">
          Save
        </button>
        <button onClick={() => setDraft(null)} type="button">
          Cancel
        </button>
      </form>
      {save.error && <p className="error">{save.error.message}</p>}
      <p className="subtle">Leave it empty and save to remove the name.</p>
    </td>
  );
}

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
  bucket,
  now,
  mayName,
}: {
  events: CalendarEvent[];
  bucket: Bucket;
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
            {(bucket === 'live' || bucket === 'upcoming') && (
              <th className="num" scope="col">
                {bucket === 'live' ? 'Ends in' : 'Starts in'}
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
              <NameCell event={event} mayName={mayName} />
              <td>{when(event.starts_at)}</td>
              <td>{when(event.ends_at)}</td>
              {bucket === 'live' && event.ends_at !== null && (
                <td className="num">{until(event.ends_at, now)}</td>
              )}
              {bucket === 'upcoming' && event.starts_at !== null && (
                <td className="num">{until(event.starts_at, now)}</td>
              )}
              <td className="num">{event.need_hq_level ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CalendarPage() {
  const { data: session } = useSession();
  const mayName = session?.role === 'officer' || session?.role === 'admin';
  const calendar = useQuery({
    queryKey: ['event-calendar'],
    queryFn: fetchCalendar,
    staleTime: STALE_TIME,
  });
  const [now] = useState(() => new Date());
  const servers = useMemo(
    () => [...new Set((calendar.data ?? []).map((event) => event.server_id))].sort(),
    [calendar.data],
  );
  const [server, setServer] = useState<number | null>(null);
  const shown = server ?? servers[0] ?? null;
  const events = useMemo(
    () => (calendar.data ?? []).filter((event) => event.server_id === shown),
    [calendar.data, shown],
  );
  const arranged = useMemo(() => arrange(events, now), [events, now]);
  const seenAt = events[0]?.seen_at ?? null;
  const unnamed = events.filter((event) => event.name === null).length;

  if (calendar.isPending) {
    return (
      <main>
        <p className="empty">Loading the game calendar…</p>
      </main>
    );
  }
  if (calendar.isError) {
    return (
      <main>
        <p className="error">Could not load the game calendar: {calendar.error.message}</p>
      </main>
    );
  }
  if (events.length === 0) {
    return (
      <main>
        <h2>Game calendar</h2>
        <p className="empty">
          No calendar yet. It arrives with the next login the collector sees on this PC — any
          account, any of the alliance's characters.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h2>Game calendar</h2>
      <p className="subtle">
        The events the game has announced, from the login the collector saw at {when(seenAt)}. Times
        are in your time zone.
        {unnamed > 0 &&
          (mayName
            ? ` ${unnamed} event${unnamed === 1 ? ' has' : 's have'} no name yet — the game sends only ids. Name them as you recognise them.`
            : ` ${unnamed} event${unnamed === 1 ? ' is' : 's are'} still known only by id.`)}
      </p>
      {servers.length > 1 && (
        <label>
          Server{' '}
          <select onChange={(change) => setServer(Number(change.target.value))} value={shown ?? ''}>
            {servers.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}
      {SECTIONS.map(({ bucket, title, blurb, open }) => {
        const list = arranged[bucket];
        if (list.length === 0) {
          return null;
        }
        return (
          <details className="calendar-section" key={bucket} open={open}>
            <summary>
              <h3 className="calendar-heading">
                {title} <span className="calendar-count">({list.length})</span>
              </h3>
            </summary>
            <p className="subtle">{blurb}</p>
            <EventTable bucket={bucket} events={list} mayName={mayName} now={now} />
          </details>
        );
      })}
    </main>
  );
}
