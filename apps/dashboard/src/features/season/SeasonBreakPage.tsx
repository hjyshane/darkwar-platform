// The weeks between one season ending and the next beginning.
//
// While a season is over, nothing on the season boards is moving: the
// buildings stopped being observed, and the rankings hold the final figures.
// This is the one place that says so, how long until the next season, and
// where the finished season's data now lives. The tab exists only in the
// break (see shellNav) and goes away by itself when the next season starts.

import { StatTile } from '../../components/StatTile';
import { FALLBACK_SEASONS, seasonPhase, useSeasons } from '../../lib/seasons';

const DAY_MS = 86_400_000;

function day(iso: string | null): string | null {
  return iso === null ? null : iso.slice(0, 10);
}

/** Whole days from `from` up to `to`, never negative. */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.ceil((to - from) / DAY_MS));
}

export function SeasonBreakPage() {
  const seasons = useSeasons();
  const now = new Date();
  const phase = seasonPhase(seasons.data ?? FALLBACK_SEASONS, now);

  if (phase.phase !== 'break') {
    return (
      <section aria-labelledby="season-break-heading">
        <h2 id="season-break-heading">Season break</h2>
        <p className="empty">
          {phase.phase === 'active'
            ? `${phase.season.name} is in progress. This page appears between seasons.`
            : 'No season has started yet.'}
        </p>
      </section>
    );
  }

  const { ended, next } = phase;
  const endedAt = ended.endsAt === null ? null : Date.parse(ended.endsAt);
  const nextAt = next?.startsAt == null ? null : Date.parse(next.startsAt);
  const ranFor =
    ended.startsAt === null || endedAt === null
      ? null
      : daysBetween(Date.parse(ended.startsAt), endedAt);

  return (
    <section aria-labelledby="season-break-heading" className="season-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            BR
          </span>
          <div>
            <h2 id="season-break-heading">Season break</h2>
            <p className="entity-meta">
              <span>
                {ended.name} settled {day(ended.endsAt) ?? 'on a date not set'}
              </span>
              <span>
                {next === null
                  ? 'Next season not scheduled yet'
                  : `${next.name} begins ${day(next.startsAt) ?? 'on a date not set'}`}
              </span>
              <span>Server time, UTC−2</span>
            </p>
          </div>
        </header>
        <div className="strip">
          <StatTile
            hero
            label={next === null ? 'Next season' : `Until ${next.name}`}
            note={nextAt === null ? 'start date not set' : 'days, from now'}
            value={nextAt === null ? null : daysBetween(now.getTime(), nextAt)}
          />
          <StatTile
            label={`Since ${ended.name} ended`}
            note="days"
            value={endedAt === null ? null : daysBetween(endedAt, now.getTime())}
          />
          <StatTile label={`${ended.name} ran`} note="days" value={ranFor} />
        </div>
      </div>

      <div className="panel">
        <h3>Where things are</h3>
        <ul>
          <li>
            <a href="#/season">{ended.name} boards</a> — the buildings and rankings as the season
            left them. Nothing here is moving.
          </li>
          <li>
            <a href="#/participation">Participation</a> — pick <strong>Season</strong> for the whole
            of {ended.name}, or <strong>Custom</strong> for any dates.
          </li>
          <li>
            <a href="#/black-gold">Black Gold</a> and the other events carry on through the break.
          </li>
        </ul>
        <p className="note">
          This tab goes away when {next === null ? 'the next season' : next.name} starts, and the
          season tab then follows it. {ended.name} stays reachable for admins as the previous
          season.
        </p>
      </div>
    </section>
  );
}
