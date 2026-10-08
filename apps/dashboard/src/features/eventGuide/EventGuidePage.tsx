import { useMemo, useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { humanUntil } from '../../lib/shellNav';
import { SERVER_ZONE, zonedTime } from '../../lib/timezone';
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
  bestActions,
  duelBoard,
  duelCoverage,
  runningNow,
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

/** What the alliance's events are and what scores in them.
 *
 * Nothing about a member is on this page: what a person earns depends on their
 * buffs, so it lists the actions that score and their base value. All times are
 * server time (UTC-2), the clock the members read. */
export function EventGuidePage() {
  const guide = useEventGuide();
  const times = useCapturedTimes();

  return (
    <section aria-labelledby="guide-heading" className="event-guide">
      <OurTimes error={times.error} loading={times.isPending} rows={times.data ?? []} />
      {(times.data ?? []).length > 0 && <AllianceTimes rows={times.data ?? []} />}

      {guide.isPending && <p className="empty loading">Loading…</p>}
      {guide.error && <p className="error">Could not load the guide: {guide.error.message}</p>}
      {guide.data && guide.data.themes.length === 0 && (
        <p className="empty">
          The guide has not been loaded from the game yet (dw-collector game-event-guide).
        </p>
      )}
      {guide.data && guide.data.themes.length > 0 && (
        <>
          <Preparedness guide={guide.data} />
          <Duel guide={guide.data} />
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
              note={`${serverWhen(row.startsAt).split(' · ')[0]} · in ${humanUntil(Date.parse(row.startsAt) - now)}`}
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
              <span className="subtle">{serverWhen(row.startsAt)}</span>
              <strong>
                {state === 'ahead' && `in ${humanUntil(startsIn)}`}
                {state === 'running' &&
                  row.endsAt !== null &&
                  `on now, ends ${zonedTime(row.endsAt, SERVER_ZONE)}`}
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
  return (
    <ul className="guide-scores">
      {rows.map((row) => (
        <li key={row.score_id}>
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
          Running now: <strong>{running.name}</strong>, until {running.until} server time.
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
                <th scope="row">{slotStart(slotIndex + 1)}</th>
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
            <BestLine activity={SURVIVAL} eventId={theme.event_id} guide={guide} />
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
            <BestLine activity={DUEL} eventId={theme.event_id} guide={guide} />
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
      <DuelScores />
    </section>
  );
}

/** The two best things to do in a theme, ahead of the whole list. */
function BestLine({
  guide,
  activity,
  eventId,
}: {
  guide: EventGuide;
  activity: string;
  eventId: string;
}) {
  const best = bestActions(guide.scores, activity, eventId, 2);
  if (best.length === 0) return null;
  return (
    <p className="guide-best">
      <span>Best</span> {best.join(' · ')}
    </p>
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
      <h3>Member scores</h3>
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
