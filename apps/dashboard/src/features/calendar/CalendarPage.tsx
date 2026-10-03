// The game's own event calendar, as the server sent it with the last login
// the collector saw (0208). Not the alliance's schedule boards — those are
// what officers plan; this is what the game has announced.
//
// Four views, the week first: week, day and month draw every event as a bar
// grouped by category (nothing folded); the day adds the four-hour blocks
// Survival Preparedness turns over on; the list searches by name and by day.
// All filter by category
// (0211) — major fights, recurring, season, events, passes, premium — read
// from the game's own activity types. Season events end with the season
// (endWithSeason). Every time is server time, UTC−2.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSession } from '../../lib/useSession';
import { DayView } from './DayView';
import { ListView } from './ListView';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  DEFAULT_SHOWN,
  endWithSeason,
  fetchCalendar,
  inCategory,
  search,
  serverDay,
  serverWhen,
} from './data';

/** The calendar changes when somebody logs in, not by the minute. */
const STALE_TIME = 5 * 60_000;

type View = 'week' | 'day' | 'month' | 'list';

const VIEWS: ReadonlyArray<[View, string]> = [
  ['month', 'Monthly'],
  ['week', 'Weekly'],
  ['day', 'Daily'],
  ['list', 'List'],
];

export function CalendarPage() {
  const { data: session } = useSession();
  const mayName = session?.role === 'officer' || session?.role === 'admin';
  const calendar = useQuery({
    queryKey: ['event-calendar'],
    queryFn: fetchCalendar,
    staleTime: STALE_TIME,
  });
  const [now] = useState(() => new Date());
  const [view, setView] = useState<View>('week');
  const today = serverDay(now.toISOString());
  // The server day the week, day and month views are on.
  const [focus, setFocus] = useState(today);
  const [shown, setShown] = useState<ReadonlySet<Category>>(DEFAULT_SHOWN);
  const [text, setText] = useState('');
  const [day, setDay] = useState('');

  const servers = useMemo(
    () => [...new Set((calendar.data ?? []).map((event) => event.server_id))].sort(),
    [calendar.data],
  );
  const [server, setServer] = useState<number | null>(null);
  const serverShown = server ?? servers[0] ?? null;
  const onServer = useMemo(
    () => endWithSeason((calendar.data ?? []).filter((event) => event.server_id === serverShown)),
    [calendar.data, serverShown],
  );
  const inMonth = useMemo(
    () => onServer.filter((event) => inCategory(event, shown)),
    [onServer, shown],
  );
  const listed = useMemo(
    () => search(onServer, { text, day, shown }),
    [onServer, text, day, shown],
  );
  const openDay = (picked: string) => {
    setFocus(picked);
    setView('day');
  };
  const toggle = (category: Category) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });

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
  if (onServer.length === 0) {
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
        What the game has announced, from the login the collector saw at{' '}
        {serverWhen(onServer[0]?.seen_at ?? null)}. All times are server time (UTC−2).
      </p>

      <div className="row calendar-controls">
        <div role="tablist" aria-label="View">
          {VIEWS.map(([value, label]) => (
            <button
              aria-selected={view === value}
              key={value}
              onClick={() => setView(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <fieldset className="calendar-toggle">
          <legend className="visually-hidden">Show</legend>
          {CATEGORIES.map((value) => (
            <button
              aria-pressed={shown.has(value)}
              className={shown.has(value) ? `calendar-toggle-on calendar-cat-${value}` : undefined}
              key={value}
              onClick={() => toggle(value)}
              type="button"
            >
              {CATEGORY_LABELS[value]}
            </button>
          ))}
        </fieldset>
        {servers.length > 1 && (
          <label>
            Server{' '}
            <select
              onChange={(change) => setServer(Number(change.target.value))}
              value={serverShown ?? ''}
            >
              {servers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {view !== 'list' && (
        <p className="subtle calendar-legend">
          {CATEGORIES.filter((value) => shown.has(value)).map((value) => (
            <span
              className={`calendar-bar calendar-cat-${value} calendar-bar-start calendar-bar-end calendar-legend-chip`}
              key={value}
            >
              {CATEGORY_LABELS[value]}
            </span>
          ))}
          Bars run from the first to the last server day (UTC−2). Pick a date to open that day.
        </p>
      )}
      {view === 'month' ? (
        <MonthView
          day={focus}
          events={inMonth}
          onDay={setFocus}
          onPickDay={openDay}
          today={today}
        />
      ) : view === 'week' ? (
        <WeekView day={focus} events={inMonth} onDay={setFocus} onPickDay={openDay} today={today} />
      ) : view === 'day' ? (
        <DayView day={focus} events={inMonth} now={now} onDay={setFocus} today={today} />
      ) : (
        <>
          <div className="row calendar-search">
            <input
              aria-label="Search events by name"
              onChange={(change) => setText(change.target.value)}
              placeholder="Search by name or id"
              type="search"
              value={text}
            />
            <label>
              Running on{' '}
              <input
                aria-label="Server day"
                onChange={(change) => setDay(change.target.value)}
                type="date"
                value={day}
              />
            </label>
            {(text !== '' || day !== '') && (
              <button
                onClick={() => {
                  setText('');
                  setDay('');
                }}
                type="button"
              >
                Clear
              </button>
            )}
          </div>
          <ListView day={day} events={listed} mayName={mayName} now={now} />
        </>
      )}
    </main>
  );
}
