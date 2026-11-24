import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { useIsCommunity } from '../../lib/communityAccess';
import { rich, useT } from '../../lib/i18n';
import {
  EVENT_GUIDE_TABS,
  type EventGuideTab,
  eventGuideHash,
  isEventGuideTabOpen,
} from '../../lib/route';
import { humanUntil } from '../../lib/shellNav';
import { SERVER_ZONE, browserZone, zoneLabel, zonedDayKey, zonedTime } from '../../lib/timezone';
import { replaceHash } from '../../lib/useHash';
import { serverWhen } from '../calendar/data';
import { type CapturedTime, type EventGuide, useCapturedTimes, useEventGuide } from './data';
import { localHint, runningNow, slotLocalHint, timeState } from './extras';
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
export function EventGuidePage({ tab: asked }: { tab: EventGuideTab }) {
  const t = useT();
  // A community account (0282) is outside the alliance: none of the times OUR
  // alliance chose. The guide itself is the game's.
  const isCommunity = useIsCommunity();
  const tab = isEventGuideTabOpen(asked, isCommunity) ? asked : 'today';
  const guide = useEventGuide();
  const times = useCapturedTimes(!isCommunity);
  const needsGuide = tab !== 'events';
  const timesRows = times.data ?? [];

  return (
    <section aria-labelledby="guide-heading" className="event-guide">
      <OurTimes
        error={times.error}
        loading={times.isPending && !isCommunity}
        ours={!isCommunity}
        rows={times.data ?? []}
      />
      {/* One address per tab (#/event-guide/duel), so the sidebar and a pasted
          link land on the tab itself and the back button steps between them. */}
      <Tabs
        items={EVENT_GUIDE_TABS.filter((entry) => isEventGuideTabOpen(entry.id, isCommunity)).map(
          (entry) => ({ id: entry.id, label: t(entry.label) }),
        )}
        label={t('Game guide sections')}
        onChange={(id) => {
          replaceHash(eventGuideHash(id));
        }}
        value={tab}
      />

      {tab === 'events' && <AllianceTimes rows={timesRows} />}

      {needsGuide && guide.isPending && <p className="empty loading">{t('Loading…')}</p>}
      {needsGuide && guide.error && (
        <p className="error">
          {t('Could not load the guide: {error}', { error: guide.error.message })}
        </p>
      )}
      {needsGuide && guide.data && guide.data.themes.length === 0 && (
        <p className="empty">
          {t('The guide has not been loaded from the game yet (dw-collector game-event-guide).')}
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
  ours,
}: {
  rows: readonly CapturedTime[];
  loading: boolean;
  error: Error | null;
  /** False for a reader outside the alliance: the strip is OUR times. */
  ours: boolean;
}) {
  const t = useT();
  const now = Date.now();
  const ahead = rows.filter((row) => Date.parse(row.startsAt) > now).slice(0, HOW_MANY_TIMES);
  return (
    <div className="entity">
      <header className="entity-head">
        <span aria-hidden="true" className="entity-mark">
          EV
        </span>
        <div>
          <h2 id="guide-heading">{t('Game guide')}</h2>
          <p className="entity-meta">
            <span>{t('Server time, UTC−2')}</span>
            {zoneLabel(browserZone()) !== zoneLabel(SERVER_ZONE) && (
              <span>{t('Your time in brackets: {zone}', { zone: zoneLabel(browserZone()) })}</span>
            )}
            <span>{t('Points are the base value: buffs change what a person earns')}</span>
          </p>
        </div>
      </header>
      {loading && <p className="empty loading">{t('Loading…')}</p>}
      {error && (
        <p className="error">{t('Could not load the times: {error}', { error: error.message })}</p>
      )}
      {ours && !loading && !error && ahead.length === 0 && (
        <p className="empty">
          {t(
            'No siege, Frankie or Black Gold time ahead has been read from the game yet. They arrive when a member of the alliance logs in on the collector.',
          )}
        </p>
      )}
      {ahead.length > 0 && (
        <div className="strip">
          {ahead.map((row, index) => (
            <StatTile
              hero={index === 0}
              key={row.id}
              label={row.title}
              note={`${serverWhen(row.startsAt).split(' · ')[0]} · ${t('in {time}', { time: humanUntil(Date.parse(row.startsAt) - now, t) })}${bracket(localHint(row.startsAt, browserZone()))}`}
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
  const t = useT();
  const now = new Date();
  const zone = browserZone();
  if (rows.length === 0) {
    return (
      <p className="empty">
        {t(
          'Nothing has been read from the game yet. Siege, Frankie and Black Gold times arrive when a member of the alliance logs in on the collector.',
        )}
      </p>
    );
  }
  return (
    <section aria-labelledby="guide-times-heading" className="panel">
      <h2 id="guide-times-heading">{t('Alliance events')}</h2>
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
                {state === 'ahead' && t('in {time}', { time: humanUntil(startsIn, t) })}
                {state === 'running' &&
                  row.endsAt !== null &&
                  `${t('on now, ends {time}', { time: zonedTime(row.endsAt, SERVER_ZONE) })}${bracket(localHint(row.endsAt, zone))}`}
                {state === 'over' && t('over')}
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
  const t = useT();
  const rows = scoresOf(guide.scores, activity, eventId);
  if (rows.length === 0) {
    return <p className="empty">{t('The game lists nothing that scores here.')}</p>;
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
            <span className="guide-best-mark" title={t('One of the best payments here')}>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
                <path d="M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.9l-4.2 2.3.8-4.7L1.2 6.2l4.7-.7z" />
              </svg>
              <span className="visually-hidden">{t('Best')}</span>
            </span>
          )}
          <span>{actionText(row.action, row.per_value, t)}</span>
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
  const t = useT();
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
        <h2 id="guide-now-sp-heading">{t('Survival Preparedness, now')}</h2>
        {running === null || eventId === null ? (
          <p className="empty">{t('The game has not told us what runs in this slot.')}</p>
        ) : (
          <>
            <p className="guide-now">
              {rich(t('{name}, until {time} server time{local}.', { time: running.until }), {
                name: <strong>{running.name}</strong>,
                local: bracket(slotLocalHint(here.slot + 1, now, zone)),
              })}
            </p>
            <ScoreList activity={SURVIVAL} eventId={eventId} guide={guide} />
          </>
        )}
      </section>
      <section aria-labelledby="guide-now-duel-heading" className="panel">
        <h2 id="guide-now-duel-heading">{t('Alliance Duel, today')}</h2>
        {duelToday === undefined ? (
          <p className="empty">
            {here.weekday === 7
              ? t('No Alliance Duel on Sunday.')
              : t("Today's Duel theme has not been loaded from the game yet.")}
          </p>
        ) : (
          <>
            <p className="guide-now">
              {t(WEEKDAYS[here.weekday - 1] ?? '')} ·{' '}
              <strong>{duelToday.name ?? duelToday.event_id}</strong>
            </p>
            <ScoreList activity={DUEL} eventId={duelToday.event_id} guide={guide} />
          </>
        )}
      </section>
      {todays.length > 0 && (
        <section aria-labelledby="guide-now-times-heading" className="panel">
          <h2 id="guide-now-times-heading">{t('Alliance events today')}</h2>
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
                      t('in {time}', {
                        time: humanUntil(Date.parse(row.startsAt) - now.getTime(), t),
                      })}
                    {state === 'running' && t('on now')}
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
  const t = useT();
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
      <p className="subtle">{t('Six four-hour slots a day; each runs one of the themes below.')}</p>
      {running !== null && (
        <p className="guide-now">
          {rich(
            t('Running now: {name}, until {time} server time{local}.', { time: running.until }),
            {
              name: <strong>{running.name}</strong>,
              local: bracket(slotLocalHint(here.slot + 1, new Date(), browserZone())),
            },
          )}
        </p>
      )}
      <div className="table-wrap">
        <table className="compact guide-week">
          <thead>
            <tr>
              <th scope="col">{t('Slot')}</th>
              {WEEKDAYS.map((day, dayIndex) => (
                <th
                  aria-current={dayIndex + 1 === here.weekday ? 'date' : undefined}
                  key={day}
                  scope="col"
                >
                  {t(day)}
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
  const t = useT();
  const themes = themesOf(guide.themes, DUEL);
  const missing = missingDuelDays(guide.themes);
  const first = themes[0];
  const today = serverNow(new Date()).weekday;
  return (
    <section aria-labelledby="guide-duel-heading" className="panel">
      <h2 id="guide-duel-heading">Alliance Duel</h2>
      {first?.min_day_score != null && (
        <p className="subtle">
          {first.min_week_score != null
            ? t("A day's reward needs {day} points that day, and the week's {week}.", {
                day: first.min_day_score.toLocaleString('en'),
                week: first.min_week_score.toLocaleString('en'),
              })
            : t("A day's reward needs {day} points that day.", {
                day: first.min_day_score.toLocaleString('en'),
              })}
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
              {t(WEEKDAYS[(theme.day ?? 1) - 1] ?? '')} · {theme.name ?? theme.event_id}
              {theme.day === today && <span className="guide-today">{t('Today')}</span>}
            </h3>
            <ScoreList activity={DUEL} eventId={theme.event_id} guide={guide} />
          </article>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="note">
          {t(
            'Not loaded yet: {days}. The Duel repeats Monday to Saturday every week and has none on Sunday.',
            { days: missing.map((day) => t(WEEKDAYS[day - 1] ?? '')).join(', ') },
          )}
        </p>
      )}
    </section>
  );
}
