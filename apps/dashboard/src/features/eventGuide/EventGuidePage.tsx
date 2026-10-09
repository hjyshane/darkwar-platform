import { useMemo, useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { EVENT_GUIDE_TABS, type EventGuideTab, eventGuideHash } from '../../lib/route';
import { humanUntil } from '../../lib/shellNav';
import { SERVER_ZONE, browserZone, zoneLabel, zonedDayKey, zonedTime } from '../../lib/timezone';
import { replaceHash } from '../../lib/useHash';
import { serverWhen } from '../calendar/data';
import {
  type CapturedTime,
  type EventGuide,
  useCapturedTimes,
  useDuelBoard,
  useEventGuide,
} from './data';
import {
  type DuelSort,
  duelBoard,
  duelCoverage,
  localHint,
  runningNow,
  slotLocalHint,
  timeState,
} from './extras';
import {
  DUEL,
  SURVIVAL,
  WEEKDAYS,
  actionText,
  bestPerUnit,
  missingDuelDays,
  pointsText,
  scoresOf,
  serverNow,
  slotStart,
  themesOf,
  weekGrid,
  worth,
} from './guide';

const HOW_MANY_TIMES = 4;

/** ` (22:30)` after a server time, or nothing where the reader's clock is the
 * server's. */
const bracket = (hint: string) => (hint === '' ? '' : ` (${hint})`);

/** What the alliance's events are and what scores in them.
 *
 * Nothing about a member is on this page: what a person earns depends on their
 * buffs, so it lists the actions that score and their base value. All times are
 * server time (UTC-2), the clock the members read. */
export function EventGuidePage({ tab }: { tab: EventGuideTab }) {
  const guide = useEventGuide();
  const times = useCapturedTimes();
  const needsGuide = tab !== 'events' && tab !== 'scores';
  const timesRows = times.data ?? [];

  return (
    <section aria-labelledby="guide-heading" className="event-guide">
      <OurTimes error={times.error} loading={times.isPending} rows={times.data ?? []} />
      {/* One address per tab (#/event-guide/duel), so the sidebar and a pasted
          link land on the tab itself and the back button steps between them. */}
      <Tabs
        items={EVENT_GUIDE_TABS.map((entry) => ({ id: entry.id, label: entry.label }))}
        label="Event guide sections"
        onChange={(id) => {
          replaceHash(eventGuideHash(id));
        }}
        value={tab}
      />

      {tab === 'events' && <AllianceTimes rows={timesRows} />}
      {tab === 'scores' && (
        <section aria-labelledby="guide-scores-heading" className="panel">
          <h2 id="guide-scores-heading">Alliance Duel: member scores</h2>
          <DuelScores />
        </section>
      )}

      {needsGuide && guide.isPending && <p className="empty loading">Loading…</p>}
      {needsGuide && guide.error && (
        <p className="error">Could not load the guide: {guide.error.message}</p>
      )}
      {needsGuide && guide.data && guide.data.themes.length === 0 && (
        <p className="empty">
          The guide has not been loaded from the game yet (dw-collector game-event-guide).
        </p>
      )}
      {needsGuide && guide.data && guide.data.themes.length > 0 && (
        <>
          {tab === 'today' && <Now guide={guide.data} rows={timesRows} />}
          {tab === 'survival' && <Preparedness guide={guide.data} />}
          {tab === 'duel' && <Duel guide={guide.data} />}
        </>
      )}
    </section>
  );
}

/** The header: the page's name, then the next few things the alliance has on as
 * a strip, which is what somebody opens this page to look up first. */
function OurTimes({
  rows,
  loading,
  error,
}: {
  rows: readonly CapturedTime[];
  loading: boolean;
  error: Error | null;
}) {
  const now = Date.now();
  const ahead = rows.filter((row) => Date.parse(row.startsAt) > now).slice(0, HOW_MANY_TIMES);
  return (
    <div className="entity">
      <header className="entity-head">
        <span aria-hidden="true" className="entity-mark">
          EV
        </span>
        <div>
          <h2 id="guide-heading">Event guide</h2>
          <p className="entity-meta">
            <span>Server time, UTC−2</span>
            {zoneLabel(browserZone()) !== zoneLabel(SERVER_ZONE) && (
              <span>Your time in brackets: {zoneLabel(browserZone())}</span>
            )}
            <span>Points are the base value: buffs change what a person earns</span>
          </p>
        </div>
      </header>
      {loading && <p className="empty loading">Loading…</p>}
      {error && <p className="error">Could not load the times: {error.message}</p>}
      {!loading && !error && ahead.length === 0 && (
        <p className="empty">
          No siege, Frankie or Black Gold time ahead has been read from the game yet. They arrive
          when a member of the alliance logs in on the collector.
        </p>
      )}
      {ahead.length > 0 && (
        <div className="strip">
          {ahead.map((row, index) => (
            <StatTile
              hero={index === 0}
              key={row.id}
              label={row.title}
              note={`${serverWhen(row.startsAt).split(' · ')[0]} · in ${humanUntil(Date.parse(row.startsAt) - now)}${bracket(localHint(row.startsAt, browserZone()))}`}
              value={zonedTime(row.startsAt, SERVER_ZONE)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Everything the game told us about the alliance's own events: what is still
 * ahead, what is on now, and what ended in the last day. The strip above only
 * has room for the next few. */
function AllianceTimes({ rows }: { rows: readonly CapturedTime[] }) {
  const now = new Date();
  const zone = browserZone();
  if (rows.length === 0) {
    return (
      <p className="empty">
        Nothing has been read from the game yet. Siege, Frankie and Black Gold times arrive when a
        member of the alliance logs in on the collector.
      </p>
    );
  }
  return (
    <section aria-labelledby="guide-times-heading" className="panel">
      <h2 id="guide-times-heading">Alliance events</h2>
      <ul className="guide-times">
        {rows.map((row) => {
          const state = timeState(row, now);
          const startsIn = Date.parse(row.startsAt) - now.getTime();
          return (
            <li data-state={state} key={row.id}>
              <span>{row.title}</span>
              <span className="subtle">
                {serverWhen(row.startsAt)}
                {bracket(localHint(row.startsAt, zone))}
              </span>
              <strong>
                {state === 'ahead' && `in ${humanUntil(startsIn)}`}
                {state === 'running' &&
                  row.endsAt !== null &&
                  `on now, ends ${zonedTime(row.endsAt, SERVER_ZONE)}${bracket(localHint(row.endsAt, zone))}`}
                {state === 'over' && 'over'}
              </strong>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ScoreList({
  guide,
  activity,
  eventId,
}: {
  guide: EventGuide;
  activity: string;
  eventId: string;
}) {
  const rows = scoresOf(guide.scores, activity, eventId);
  if (rows.length === 0) {
    return <p className="empty">The game lists nothing that scores here.</p>;
  }
  const best = bestPerUnit(rows);
  // The top two payments carry a small tilted mark on the row itself, which
  // stands out without a second list repeating them. A theme with two rows has
  // one best; with one row there is nothing to compare it with.
  const marked = rows.length > 2 ? 2 : rows.length > 1 ? 1 : 0;
  return (
    <ul className="guide-scores">
      {rows.map((row, rank) => (
        <li key={row.score_id}>
          {rank < marked && (
            <span className="guide-best-mark" title="One of the best payments here">
              <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                <path d="M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.9l-4.2 2.3.8-4.7L1.2 6.2l4.7-.7z" />
              </svg>
              <span className="visually-hidden">Best</span>
            </span>
          )}
          <span>{actionText(row.action, row.per_value)}</span>
          <strong className="num">{pointsText(row.points)}</strong>
          <span aria-hidden="true" className="guide-bar">
            <span style={{ width: `${Math.round(worth(row, best) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The first screen: only what is on today, at this hour. The Survival
 * Preparedness theme of the slot running now, today's Duel theme, and the
 * alliance events still to come or running today (server day). The whole week
 * and every theme are the tabs after this one. */
function Now({ guide, rows }: { guide: EventGuide; rows: readonly CapturedTime[] }) {
  const now = new Date();
  const zone = browserZone();
  const here = serverNow(now);
  const grid = weekGrid(guide.calendar, SURVIVAL);
  const survivalThemes = themesOf(guide.themes, SURVIVAL);
  const eventId = grid[here.slot - 1]?.[here.weekday - 1] ?? null;
  const running = runningNow(grid, survivalThemes, here);
  const duelToday = themesOf(guide.themes, DUEL).find((theme) => theme.day === here.weekday);
  const todayKey = zonedDayKey(now.toISOString(), SERVER_ZONE);
  const todays = rows.filter(
    (row) => zonedDayKey(row.startsAt, SERVER_ZONE) === todayKey && timeState(row, now) !== 'over',
  );
  return (
    <>
      <section aria-labelledby="guide-now-sp-heading" className="panel">
        <h2 id="guide-now-sp-heading">Survival Preparedness, now</h2>
        {running === null || eventId === null ? (
          <p className="empty">The game has not told us what runs in this slot.</p>
        ) : (
          <>
            <p className="guide-now">
              <strong>{running.name}</strong>, until {running.until} server time
              {bracket(slotLocalHint(here.slot + 1, now, zone))}.
            </p>
            <ScoreList activity={SURVIVAL} eventId={eventId} guide={guide} />
          </>
        )}
      </section>
      <section aria-labelledby="guide-now-duel-heading" className="panel">
        <h2 id="guide-now-duel-heading">Alliance Duel, today</h2>
        {duelToday === undefined ? (
          <p className="empty">
            Today's Duel theme has not been seen yet: the game only sends it once it is that day's
            turn.
          </p>
        ) : (
          <>
            <p className="guide-now">
              {WEEKDAYS[here.weekday - 1]} · <strong>{duelToday.name ?? duelToday.event_id}</strong>
            </p>
            <ScoreList activity={DUEL} eventId={duelToday.event_id} guide={guide} />
          </>
        )}
      </section>
      {todays.length > 0 && (
        <section aria-labelledby="guide-now-times-heading" className="panel">
          <h2 id="guide-now-times-heading">Alliance events today</h2>
          <ul className="guide-times">
            {todays.map((row) => {
              const state = timeState(row, now);
              return (
                <li data-state={state} key={row.id}>
                  <span>{row.title}</span>
                  <span className="subtle">
                    {serverWhen(row.startsAt)}
                    {bracket(localHint(row.startsAt, zone))}
                  </span>
                  <strong>
                    {state === 'ahead' &&
                      `in ${humanUntil(Date.parse(row.startsAt) - now.getTime())}`}
                    {state === 'running' && 'on now'}
                  </strong>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function Preparedness({ guide }: { guide: EventGuide }) {
  const themes = themesOf(guide.themes, SURVIVAL);
  const grid = weekGrid(guide.calendar, SURVIVAL);
  const here = serverNow(new Date());
  const running = runningNow(grid, themes, here);
  const index = (id: string | null) => themes.findIndex((theme) => theme.event_id === id);
  const nameOf = (id: string | null) =>
    id === null ? '—' : (themes.find((theme) => theme.event_id === id)?.name ?? id);
  return (
    <section aria-labelledby="guide-sp-heading" className="panel">
      <h2 id="guide-sp-heading">Survival Preparedness</h2>
      <p className="subtle">Six four-hour slots a day; each runs one of the themes below.</p>
      {running !== null && (
        <p className="guide-now">
          Running now: <strong>{running.name}</strong>, until {running.until} server time
          {bracket(slotLocalHint(here.slot + 1, new Date(), browserZone()))}.
        </p>
      )}
      <div className="table-wrap">
        <table className="compact guide-week">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              {WEEKDAYS.map((day, dayIndex) => (
                <th
                  aria-current={dayIndex + 1 === here.weekday ? 'date' : undefined}
                  key={day}
                  scope="col"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, slotIndex) => (
              <tr key={slotStart(slotIndex + 1)}>
                <th scope="row">
                  {slotStart(slotIndex + 1)}
                  <span className="guide-local">
                    {bracket(slotLocalHint(slotIndex + 1, new Date(), browserZone()))}
                  </span>
                </th>
                {row.map((eventId, day) => (
                  <td
                    aria-current={
                      day + 1 === here.weekday && slotIndex + 1 === here.slot ? 'true' : undefined
                    }
                    className="guide-cell"
                    data-theme-index={index(eventId)}
                    key={WEEKDAYS[day]}
                  >
                    {nameOf(eventId)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="guide-themes">
        {themes.map((theme, themeIndex) => (
          <article className="guide-theme" key={theme.event_id}>
            <h3 data-theme-index={themeIndex}>{theme.name ?? theme.event_id}</h3>
            <ScoreList activity={SURVIVAL} eventId={theme.event_id} guide={guide} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Duel({ guide }: { guide: EventGuide }) {
  const themes = themesOf(guide.themes, DUEL);
  const missing = missingDuelDays(guide.themes);
  const first = themes[0];
  const today = serverNow(new Date()).weekday;
  return (
    <section aria-labelledby="guide-duel-heading" className="panel">
      <h2 id="guide-duel-heading">Alliance Duel</h2>
      {first?.min_day_score != null && (
        <p className="subtle">
          A day's reward needs {first.min_day_score.toLocaleString('en')} points that day
          {first.min_week_score != null &&
            `, and the week's ${first.min_week_score.toLocaleString('en')}`}
          .
        </p>
      )}
      <div className="guide-themes">
        {themes.map((theme) => (
          <article
            aria-current={theme.day === today ? 'date' : undefined}
            className="guide-theme"
            key={theme.event_id}
          >
            <h3>
              {WEEKDAYS[(theme.day ?? 1) - 1] ?? ''} · {theme.name ?? theme.event_id}
              {theme.day === today && <span className="guide-today">Today</span>}
            </h3>
            <ScoreList activity={DUEL} eventId={theme.event_id} guide={guide} />
          </article>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="note">
          Not seen yet: {missing.map((day) => WEEKDAYS[day - 1]).join(', ')}. The game only sends a
          day's theme once it is that week's turn, so they fill in as the week goes.
        </p>
      )}
    </section>
  );
}

const plainNumber = new Intl.NumberFormat('en');

/** The members' Duel scores, daily and weekly. Alliance members only (the data
 * is behind the roster's gate), and the Duel only: it is the one board where
 * seeing everybody's score is what the alliance asked for. A muted figure is a
 * reading from an earlier day or week, kept because it is the last we have. */
function DuelScores() {
  const board = useDuelBoard();
  const [sort, setSort] = useState<DuelSort>('daily');
  const lines = useMemo(
    () => duelBoard(board.data?.members ?? [], board.data?.readings ?? [], new Date(), sort),
    [board.data, sort],
  );
  const coverage = duelCoverage(lines);
  return (
    <div className="guide-board">
      {board.isPending && <p className="empty loading">Loading…</p>}
      {board.error && <p className="error">Could not load the scores: {board.error.message}</p>}
      {board.data && lines.length === 0 && (
        <p className="empty">Member scores show for signed-in alliance members.</p>
      )}
      {lines.length > 0 && (
        <>
          <p className="subtle">
            The newest board reading for each member: {coverage.today} of {lines.length} have
            today's, {coverage.week} have this week's. A muted figure is from an earlier day or
            week.
          </p>
          <Tabs
            items={[
              { id: 'daily' as const, label: 'By daily' },
              { id: 'weekly' as const, label: 'By weekly' },
            ]}
            label="Sort the Duel scores"
            onChange={setSort}
            value={sort}
          />
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="label" scope="col">
                    Member
                  </th>
                  <th className="num" scope="col">
                    Daily
                  </th>
                  <th className="num" scope="col">
                    Weekly
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.playerId}>
                    <th className="label" scope="row">
                      {line.name}
                    </th>
                    <td className={line.dailyToday ? 'num' : 'num guide-stale'}>
                      {line.daily === null ? '—' : plainNumber.format(line.daily)}
                    </td>
                    <td className={line.weeklyThisWeek ? 'num' : 'num guide-stale'}>
                      {line.weekly === null ? '—' : plainNumber.format(line.weekly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
