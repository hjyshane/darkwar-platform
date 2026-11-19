import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { Led } from '../../components/console/Led';
import { compactNumber } from '../../lib/compactNumber';
import { SERVER_ZONE, zonedDayKey } from '../../lib/timezone';
import { type Battle, fetchBattles, outcome, teamLabel } from '../blackGold/data';
import { fetchAllEventKinds } from '../participation/data';
import {
  ALWAYS_LISTED,
  type EventSummary,
  OVERVIEW_DAYS,
  eventHref,
  fetchDuelDays,
  fetchVerdicts,
  foldVerdicts,
  kindLabel,
  overviewWindow,
  summariseDuel,
} from './overview';
import './alliance.css';

const compact = compactNumber(1);
const plain = new Intl.NumberFormat('ko-KR');

/** Our alliance's Overview (owner, 2026-11-19): the duel, then every alliance
 * event of the last fortnight as one line each. Replaces the intro, the newest
 * moves and the strongest-members list that stood here.
 *
 * Offered on OUR page only: every source is scoped to the alliance being
 * viewed, so on somebody else's page it would put our events under their name. */
export function AllianceOverview({ allianceId, now }: { allianceId: string; now?: Date }) {
  const window = overviewWindow(now ?? new Date());
  return (
    <div className="alliance-stack">
      <DuelPanel allianceId={allianceId} fromDay={window.fromDay} />
      <EventsPanel from={window.from} fromDay={window.fromDay} to={window.to} />
    </div>
  );
}

function DuelPanel({ allianceId, fromDay }: { allianceId: string; fromDay: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['alliance-overview', 'duel', allianceId, fromDay],
    queryFn: () => fetchDuelDays(allianceId, fromDay),
  });
  const duel = summariseDuel(data ?? []);
  return (
    <section aria-label="Alliance Duel" className="alliance-panel">
      <h2>Alliance Duel · last {OVERVIEW_DAYS} days</h2>
      {isPending ? (
        <p className="empty loading">Loading…</p>
      ) : error ? (
        <p className="error">Could not load the duel: {error.message}</p>
      ) : duel.days === 0 ? (
        <p className="empty">No duel board has been read in the last {OVERVIEW_DAYS} days.</p>
      ) : (
        <div className="stats overview-stats">
          <StatTile
            hero
            label="Our duel points"
            note={`over ${duel.days} day${duel.days === 1 ? '' : 's'} read`}
            value={compact.format(duel.total)}
          />
          <StatTile
            label="Latest day"
            note={duel.latest?.day}
            value={duel.latest === null ? null : compact.format(duel.latest.total)}
          />
          <StatTile
            label="Best day"
            note={duel.best?.day}
            value={duel.best === null ? null : compact.format(duel.best.total)}
          />
        </div>
      )}
      {/* Said rather than left blank: the heading promises a duel and a reader
          looks for the result first. */}
      <p className="alliance-panel-foot">
        Win or loss is not shown: nothing we read from the game says who the duel was against or who
        won it, only our own members' points.
      </p>
    </section>
  );
}

function blackGoldResult(battle: Battle) {
  const result = outcome(battle);
  const enemy = `${battle.enemy_abbr ? `[${battle.enemy_abbr}] ` : ''}${battle.enemy_name ?? 'unknown alliance'}`;
  return (
    <>
      <Led tone={result === 'win' ? 'ok' : result === 'loss' ? 'bad' : 'neutral'}>
        {result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Not known'}
      </Led>{' '}
      vs {enemy}
    </>
  );
}

function verdictFigures(event: EventSummary): string {
  const parts = [
    event.totalScore === null ? null : `${compact.format(event.totalScore)} score`,
    event.totalDamage === null ? null : `${compact.format(event.totalDamage)} damage`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

function EventsPanel({ from, to, fromDay }: { from: string; to: string; fromDay: string }) {
  const verdicts = useQuery({
    queryKey: ['alliance-overview', 'events', from],
    queryFn: () => fetchVerdicts(from, to),
  });
  // The Black Gold page's own read and the settings' event list, under their
  // keys: one answer in the cache, whichever screen asked first.
  const battles = useQuery({ queryKey: ['blackGold', 'battles'], queryFn: fetchBattles });
  const kinds = useQuery({ queryKey: ['attendance-kinds-all'], queryFn: fetchAllEventKinds });

  const labels: Record<string, string> = Object.fromEntries(
    (kinds.data ?? []).map((entry) => [entry.kind, entry.label]),
  );
  const events = foldVerdicts(verdicts.data ?? []);
  const recentBattles = (battles.data ?? []).filter(
    (battle) => zonedDayKey(battle.battle_ended_at, SERVER_ZONE) >= fromDay,
  );
  // Named even when not held, so a blank is an answer rather than a gap.
  const notHeld = ALWAYS_LISTED.filter((kind) => !events.some((event) => event.kind === kind));
  const loading = verdicts.isPending || battles.isPending;
  const failure = verdicts.error ?? battles.error;

  return (
    <section aria-label="Alliance events" className="alliance-panel">
      <h2>Alliance events · last {OVERVIEW_DAYS} days</h2>
      {loading ? (
        <p className="empty loading">Loading…</p>
      ) : failure ? (
        <p className="error">Could not load the events: {failure.message}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label" scope="col">
                  Event
                </th>
                <th scope="col">Day</th>
                <th scope="col">Result</th>
                <th scope="col">Took part</th>
                <th scope="col">Figures</th>
              </tr>
            </thead>
            <tbody>
              {recentBattles.map((battle) => (
                <tr key={`bg:${battle.battle_ended_at}:${battle.team_index}`}>
                  <td className="label">
                    <a href="#/black-gold">Black Gold · {teamLabel(battle.team_index)}</a>
                  </td>
                  <td>{zonedDayKey(battle.battle_ended_at, SERVER_ZONE)}</td>
                  <td>{blackGoldResult(battle)}</td>
                  <td>
                    {battle.user_num ?? '—'}
                    {battle.max_user_num === null ? '' : ` of ${battle.max_user_num}`}
                  </td>
                  <td>
                    {battle.score === null ? '—' : plain.format(battle.score)}
                    {' : '}
                    {battle.enemy_score === null ? '—' : plain.format(battle.enemy_score)}
                  </td>
                </tr>
              ))}
              {recentBattles.length === 0 && (
                <tr>
                  <td className="label">
                    <a href="#/black-gold">Black Gold</a>
                  </td>
                  <td className="subtle" colSpan={4}>
                    none in the last {OVERVIEW_DAYS} days
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={`${event.kind}:${event.day}:${event.round}`}>
                  <td className="label">
                    <a href={eventHref(event.kind)}>
                      {kindLabel(event.kind, labels)}
                      {event.round > 1 ? ` · round ${event.round}` : ''}
                    </a>
                  </td>
                  <td>{event.day}</td>
                  {/* Only Black Gold has a result we read. */}
                  <td>—</td>
                  <td title="Not known is not absent: nobody recorded them either way.">
                    {event.present} of {event.present + event.absent + event.unknown}
                    {event.unknown > 0 ? ` · ${event.unknown} not known` : ''}
                  </td>
                  <td>{verdictFigures(event)}</td>
                </tr>
              ))}
              {notHeld.map((kind) => (
                <tr key={`none:${kind}`}>
                  <td className="label">
                    <a href={eventHref(kind)}>{kindLabel(kind, labels)}</a>
                  </td>
                  <td className="subtle" colSpan={4}>
                    none in the last {OVERVIEW_DAYS} days
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="alliance-panel-foot">
        Black Gold is read from the game with its result. The others count who took part, from the
        game's boards where one is captured and from what officers record on Participation.
      </p>
    </section>
  );
}
