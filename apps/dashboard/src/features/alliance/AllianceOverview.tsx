import { useQuery } from '@tanstack/react-query';
import { compactNumber } from '../../lib/compactNumber';
import { playerHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { fetchDepartures } from '../roster/RosterPanel';
import { type OverviewMember, recentDepartures, strongest } from './overview';

const compact = compactNumber(1);
const TOP = 10;
const MOVES_DAYS = 14;

/** The top of the page's answer: who is strongest, and, for officers of our own
 * alliance, who left lately. Both come from what the page already loaded or from
 * a view that exists (0067), so there is no new query for everybody else.
 *
 * DEPARTURES ARE FOR OFFICERS. 0067 moved them off the roster because "so-and-so
 * is gone" is an administrative fact and an announcement the alliance did not ask
 * for; showing them to every reader here would undo that. Joins are not shown:
 * nothing records them yet (a roster-diff view would). */
export function AllianceOverview({
  members,
  isOwn,
  now,
}: {
  members: readonly OverviewMember[];
  isOwn: boolean;
  now?: Date;
}) {
  const { data: session } = useSession();
  const mayHearMoves = isOwn && (session?.role === 'officer' || session?.role === 'admin');
  const top = strongest(members, TOP);

  return (
    <div className="overview-pair">
      <section aria-labelledby="alliance-strongest">
        <h2 id="alliance-strongest">Strongest members</h2>
        {top.length === 0 ? (
          <p className="empty">No member power has been read for this alliance yet.</p>
        ) : (
          <ol className="overview-list">
            {top.map((member, index) => (
              <li key={member.gameUid}>
                <span className="subtle">{index + 1}</span>{' '}
                {member.playerId === null ? (
                  (member.name ?? '—')
                ) : (
                  <a href={playerHash(member.playerId)}>{member.name ?? '—'}</a>
                )}{' '}
                <span className="subtle">
                  {TERMS.hq} {member.hqLevel ?? '—'} · {compact.format(member.power ?? 0)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {mayHearMoves && <RecentMoves now={now} />}
    </div>
  );
}

function RecentMoves({ now }: { now?: Date }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['departures'],
    queryFn: fetchDepartures,
  });
  const rows = recentDepartures(data ?? [], now ?? new Date(), MOVES_DAYS);
  return (
    <section aria-labelledby="alliance-moves">
      <h2 id="alliance-moves">Left in the last {MOVES_DAYS} days</h2>
      {isPending ? (
        <p className="empty loading">Loading…</p>
      ) : error ? (
        <p className="error">Could not load departures: {error.message}</p>
      ) : rows.length === 0 ? (
        <p className="empty">Nobody has left in that time.</p>
      ) : (
        <ul className="overview-list">
          {rows.map((row) => (
            <li key={row.game_uid}>
              {row.player_id === null ? (
                (row.last_known_name ?? '—')
              ) : (
                <a href={playerHash(row.player_id)}>{row.last_known_name ?? '—'}</a>
              )}{' '}
              <span className="subtle">
                last seen {row.last_seen_in_alliance_at.slice(0, 10)}
                {row.confirmed === false && ' · unconfirmed (short roster capture)'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
