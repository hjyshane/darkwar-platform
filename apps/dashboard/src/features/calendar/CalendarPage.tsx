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
import { Strip } from '../../components/Strip';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { useT } from '../../lib/i18n';
import { CALENDAR_DEFAULT_SHOWN } from '../../lib/settings/registry';
import { useSiteSetting } from '../../lib/settings/useSiteSetting';
import { useSession } from '../../lib/useSession';
import { DayView } from './DayView';
import { EventCard } from './EventCard';
import { EventTable, ListView } from './ListView';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type CalendarEvent,
  type Category,
  endWithSeason,
  fetchCalendar,
  inCategory,
  search,
  serverDay,
  serverWhen,
  splitIdentified,
} from './data';
import { calendarStrip } from './strip';

/** The calendar changes when somebody logs in, not by the minute. */
const STALE_TIME = 5 * 60_000;

type View = 'week' | 'day' | 'month' | 'list';

export function CalendarPage() {
  const t = useT();
  const views: ReadonlyArray<[View, string]> = [
    ['month', t('Monthly')],
    ['week', t('Weekly')],
    ['day', t('Daily')],
    ['list', t('List')],
  ];
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
  // What an admin chose to show first (Settings › Shared › Site values), until
  // the reader toggles a category; from then on, theirs.
  const shownAtFirst = useSiteSetting(CALENDAR_DEFAULT_SHOWN);
  const [picked, setPicked] = useState<ReadonlySet<Category> | null>(null);
  const shown = useMemo(() => picked ?? new Set(shownAtFirst), [picked, shownAtFirst]);
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
  // An event with no name is not drawn: it is listed apart, under the views.
  const { identified, unidentified } = useMemo(() => splitIdentified(onServer), [onServer]);
  const inMonth = useMemo(
    () => identified.filter((event) => inCategory(event, shown)),
    [identified, shown],
  );
  const listed = useMemo(
    () => search(identified, { text, day, shown }),
    [identified, text, day, shown],
  );
  // The open card, by id: the event is looked up again on every render, so a
  // rename made from the card shows on it.
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = onServer.find((event) => event.activity_id === openId) ?? null;
  const open = (event: CalendarEvent) => setOpenId(event.activity_id);
  const openDay = (picked: string) => {
    setFocus(picked);
    setView('day');
  };
  const toggle = (category: Category) =>
    setPicked((current) => {
      const next = new Set(current ?? shownAtFirst);
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
        <p className="empty">{t('Loading the game calendar…')}</p>
      </main>
    );
  }
  if (calendar.isError) {
    return (
      <main>
        <p className="error">
          {t('Could not load the game calendar: {error}', { error: calendar.error.message })}
        </p>
      </main>
    );
  }
  if (onServer.length === 0) {
    return (
      <main>
        <h2>{t('Game calendar')}</h2>
        <p className="empty">
          {t(
            "No calendar yet. It arrives with the next login the collector sees on this PC — any account, any of the alliance's characters.",
          )}
        </p>
      </main>
    );
  }

  return (
    <main className="calendar-page">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            GC
          </span>
          <div>
            <h2>{t('Game calendar')}</h2>
            <p className="entity-meta">
              <span>{t('What the game has announced')}</span>
              <span>{t('Server time, UTC−2')}</span>
              {servers.length > 1 && (
                <span>{t('Server {server}', { server: serverShown ?? '' })}</span>
              )}
            </p>
          </div>
        </header>
        <Strip cells={calendarStrip(identified, now, t)} />
        <p className="entity-foot">
          {t('From the login the collector saw at {when}.', {
            when: serverWhen(onServer[0]?.seen_at ?? null),
          })}
        </p>
      </div>

      <div className="panel calendar-panel">
        <div className="row calendar-controls">
          <Tabs
            label={t('View')}
            items={views.map(([value, label]) => ({ id: value, label }))}
            value={view}
            onChange={setView}
          />
          <fieldset className="calendar-toggle">
            <legend className="visually-hidden">{t('Show')}</legend>
            {CATEGORIES.map((value) => (
              <button
                aria-pressed={shown.has(value)}
                className={
                  shown.has(value) ? `calendar-toggle-on calendar-cat-${value}` : undefined
                }
                key={value}
                onClick={() => toggle(value)}
                type="button"
              >
                {t(CATEGORY_LABELS[value])}
              </button>
            ))}
          </fieldset>
          {servers.length > 1 && (
            <label>
              {t('Server')}{' '}
              <Select onChange={(next) => setServer(Number(next))} value={serverShown ?? ''}>
                {servers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
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
                {t(CATEGORY_LABELS[value])}
              </span>
            ))}
            {t(
              'Bars run from the first to the last server day (UTC−2). Pick a date to open that day, or an event to see what it is.',
            )}
          </p>
        )}
        {view === 'month' ? (
          <MonthView
            day={focus}
            events={inMonth}
            onDay={setFocus}
            onOpen={open}
            onPickDay={openDay}
            today={today}
          />
        ) : view === 'week' ? (
          <WeekView
            day={focus}
            events={inMonth}
            onDay={setFocus}
            onOpen={open}
            onPickDay={openDay}
            today={today}
          />
        ) : view === 'day' ? (
          <DayView
            day={focus}
            events={inMonth}
            now={now}
            onDay={setFocus}
            onOpen={open}
            today={today}
          />
        ) : (
          <>
            <div className="row calendar-search">
              <input
                aria-label={t('Search events by name')}
                onChange={(change) => setText(change.target.value)}
                placeholder={t('Search by name or id')}
                type="search"
                value={text}
              />
              <label>
                {t('Running on')}{' '}
                <input
                  aria-label={t('Server day')}
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
                  {t('Clear')}
                </button>
              )}
            </div>
            <ListView day={day} events={listed} mayName={mayName} now={now} onOpen={open} />
          </>
        )}
      </div>

      {unidentified.length > 0 && (
        <details className="panel calendar-unidentified">
          <summary>
            <h3 className="calendar-heading">
              {t('Unidentified')} <span className="calendar-count">({unidentified.length})</span>
            </h3>
          </summary>
          <p className="subtle">
            {t(
              'The server lists these ids, but the game client has no name for them, so nobody can say what they are. They are kept off the calendar and out of the figures above.',
            )}
            {mayName && ` ${t('Name one and it joins the calendar.')}`}
          </p>
          <EventTable
            countdown={null}
            events={unidentified}
            mayName={mayName}
            now={now}
            onOpen={open}
          />
        </details>
      )}

      {opened !== null && (
        <EventCard
          event={opened}
          key={opened.activity_id}
          mayName={mayName}
          now={now}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  );
}
