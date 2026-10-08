import { serverWhen } from '../calendar/data';
import { type CapturedTime, useCapturedTimes, useEventGuide } from './data';
import type { EventGuide } from './data';
import {
  DUEL,
  SURVIVAL,
  WEEKDAYS,
  actionText,
  missingDuelDays,
  pointsText,
  scoresOf,
  slotStart,
  themesOf,
  weekGrid,
} from './guide';

/** What the alliance's events are and what scores in them.
 *
 * Nothing about a member is on this page: what a person earns depends on their
 * buffs, so it lists the actions that score and their base value. All times are
 * server time (UTC−2), the clock the members read. */
export function EventGuidePage() {
  const guide = useEventGuide();
  const times = useCapturedTimes();

  return (
    <section aria-labelledby="guide-heading" className="event-guide">
      <h2 id="guide-heading">Event guide</h2>
      <p className="subtle">
        What each event is and which actions score in it, as the game lists them. Points are the
        base value: buffs change what a person actually earns. All times are server time (UTC−2).
      </p>

      <AllianceTimes error={times.error} loading={times.isPending} rows={times.data ?? []} />

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

function AllianceTimes({
  rows,
  loading,
  error,
}: {
  rows: readonly CapturedTime[];
  loading: boolean;
  error: Error | null;
}) {
  return (
    <section aria-labelledby="guide-times-heading">
      <h3 id="guide-times-heading">Our times</h3>
      {loading && <p className="empty loading">Loading…</p>}
      {error && <p className="error">Could not load the times: {error.message}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="empty">
          No siege, Frankie or Black Gold time has been read from the game yet. They arrive when a
          member of the alliance logs in on the collector.
        </p>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Starts</th>
                <th scope="col">Ends</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.title}</th>
                  <td>{serverWhen(row.startsAt)}</td>
                  <td>{serverWhen(row.endsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ScoreList({
  guide,
  activity,
  eventId,
}: { guide: EventGuide; activity: string; eventId: string }) {
  const rows = scoresOf(guide.scores, activity, eventId);
  if (rows.length === 0) {
    return <p className="empty">The game lists nothing that scores here.</p>;
  }
  return (
    <ul className="guide-scores">
      {rows.map((row) => (
        <li key={row.score_id}>
          <span>{actionText(row.action, row.per_value)}</span>
          <strong className="num">{pointsText(row.points)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Preparedness({ guide }: { guide: EventGuide }) {
  const themes = themesOf(guide.themes, SURVIVAL);
  const grid = weekGrid(guide.calendar, SURVIVAL);
  const nameOf = (id: string | null) =>
    id === null ? '—' : (themes.find((theme) => theme.event_id === id)?.name ?? id);
  return (
    <section aria-labelledby="guide-sp-heading">
      <h3 id="guide-sp-heading">Survival Preparedness</h3>
      <p className="subtle">Six four-hour slots a day; each runs one of the themes below.</p>
      <div className="table-wrap">
        <table className="compact guide-week">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, index) => (
              <tr key={slotStart(index + 1)}>
                <th scope="row">{slotStart(index + 1)}</th>
                {row.map((eventId, day) => (
                  <td key={WEEKDAYS[day]}>{nameOf(eventId)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="guide-themes">
        {themes.map((theme) => (
          <article className="guide-theme" key={theme.event_id}>
            <h4>{theme.name ?? theme.event_id}</h4>
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
  return (
    <section aria-labelledby="guide-duel-heading">
      <h3 id="guide-duel-heading">Alliance Duel</h3>
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
          <article className="guide-theme" key={theme.event_id}>
            <h4>
              {WEEKDAYS[(theme.day ?? 1) - 1] ?? ''} · {theme.name ?? theme.event_id}
            </h4>
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
