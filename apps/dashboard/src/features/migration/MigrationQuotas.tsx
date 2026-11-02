import { useQuery } from '@tanstack/react-query';
import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { TierBadge } from './TierBadge';
import { fetchTierBoard, summarize } from './candidates';
import { num, power } from './format';
import { type MigrationQuotaServer, fetchMigrationQuotas, seatList } from './quota';

const STALE_TIME = 5 * 60_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** Special seats by the game's type number (1, 2, 3); a plain number is one pool. The mapping
 * of a special type to a tier is not known, so the type is shown as the game numbers it. */
function Special({ value }: { value: unknown }) {
  const seats = seatList(value);
  if (seats === null) return <span title="shape not recognised — see the raw snapshot">—</span>;
  if (seats.length === 0) return <span className="subtle">none</span>;
  return (
    <>
      {seats.map(([type, n], index) => (
        <span key={type}>
          {index > 0 && ' · '}
          <span className="subtle">{type === 0 ? 'seats' : `type ${type}`}</span> {num(n)}
        </span>
      ))}
    </>
  );
}

/** A plain seat count, or a dash when the game sent something else. */
function Count({ value }: { value: unknown }) {
  const seats = seatList(value);
  if (seats === null) return <span title="shape not recognised — see the raw snapshot">—</span>;
  return <>{num(seats.reduce((sum, [, n]) => sum + n, 0))}</>;
}

/** What each tier takes right now: the place range the game cuts on, and the power of the
 * weakest player standing in it on the merged state-list board. */
function Tiers() {
  const board = useQuery({
    queryKey: ['migration', 'tiers'],
    queryFn: fetchTierBoard,
    staleTime: STALE_TIME,
  });
  const summary = summarize(board.data ?? []);
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption>
          The four tiers, by place on the merged state-list board of servers 567–588
        </caption>
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col" className="numeric">
              Places
            </th>
            <th scope="col" className="numeric">
              Power of the last place
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.tier}>
              <th scope="row">
                <TierBadge tier={s.tier} />
              </th>
              <td className="numeric">
                {s.last === null ? `${num(s.first)} and below` : `${num(s.first)}–${num(s.last)}`}
              </td>
              <td className="numeric" title={s.floorPower === null ? undefined : num(s.floorPower)}>
                {s.last === null ? '—' : s.floorPower === null ? '—' : power(s.floorPower)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {board.isPending && <p className="empty loading">Loading…</p>}
      {board.error && <p className="error">{board.error.message}</p>}
    </div>
  );
}

function Offer({ rows }: { rows: MigrationQuotaServer[] }) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption>What each server is offering, newest reading</caption>
        <thead>
          <tr>
            <th scope="col">Server</th>
            <th scope="col" className="numeric">
              Seats left
            </th>
            <th scope="col">Special seats left</th>
            <th scope="col" className="numeric">
              Invite seats left
            </th>
            <th
              scope="col"
              className="numeric"
              title="The least power its president accepts; none when 0"
            >
              Power floor
            </th>
            <th scope="col">Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const floor = s.power_low_limit?.[0] ?? null;
            return (
              <tr key={s.server_id}>
                <th scope="row">
                  <a href={serverHash(s.server_id)}>{s.server_id}</a>
                </th>
                <td className="numeric">
                  <Count value={s.migrate_left} />
                </td>
                <td>
                  <Special value={s.special_left} />
                </td>
                <td className="numeric">
                  <Count value={s.invite_left} />
                </td>
                <td className="numeric" title={floor === null ? undefined : num(floor)}>
                  {floor === null || floor === 0 ? '—' : power(floor)}
                </td>
                <td>{serverTime(s.captured_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const GLOSSARY: ReadonlyArray<readonly [string, string]> = [
  [
    'Tier',
    'Backbone, Advanced, Elite or Commander: set by a player’s place on the merged board of the strongest 150 players of every server in the migration range, ranked by power.',
  ],
  ['Place', 'Position on that merged board, not on the player’s own server list.'],
  [
    'Migrate power',
    'The game’s own figure for a player’s move. It is fixed at one moment, not live, and cannot be worked out from current power.',
  ],
  [
    'Mover',
    'A player on a server other than the one their account started on (the last six digits of their uid).',
  ],
  [
    'Power floor',
    'The least power a server’s president accepts; each server sets its own, and 0 means none.',
  ],
  [
    'Special seat',
    'A limited seat of type 1, 2 or 3 per server with its own migrate-power minimum.',
  ],
  ['Invite seat', 'A seat held for players the server invites.'],
];

/** The migration rules as the game states them, with what this page has seen of the offer. */
export function MigrationQuotas() {
  const quotas = useQuery({
    queryKey: ['migration', 'quotas'],
    queryFn: fetchMigrationQuotas,
    staleTime: STALE_TIME,
  });

  return (
    <>
      <Tiers />

      <h3>Seats</h3>
      {quotas.isPending && <p className="empty loading">Loading…</p>}
      {quotas.error && <p className="error">{quotas.error.message}</p>}
      {quotas.data &&
        (quotas.data.length === 0 ? (
          <p className="empty">
            No per-server offer has been read yet. Open the migration tab's server list in the game
            with the collector running.
          </p>
        ) : (
          <Offer rows={quotas.data} />
        ))}

      <h3>Rules seen in the game</h3>
      <ul>
        <li>
          A move costs 10 of item 252000, and the game lists a cooldown of 2,592,000 seconds (30
          days).
        </li>
        <li>
          Before the window opened every server showed 30 seats and 30 invite seats, and special
          seats of type 1, 2 and 3 (1, 1 and 5 seats) that need a migrate power of at least 32M, 18M
          and 10M. These figures were identical on every server read.
        </li>
        <li>
          Which tier a special type belongs to has not been confirmed, so it is shown as the game
          numbers it.
        </li>
        <li>The migration window of this season ends 2026-11-06 00:00 server time.</li>
      </ul>
      <p className="note">
        Read from <code>get.migrate.item</code> and <code>get.migrate.servers</code> on 2026-10-27;
        the game may change them, and this list does not update itself.
      </p>

      <h3>Terms</h3>
      <dl>
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term}>
            <dt>
              <strong>{term}</strong>
            </dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
