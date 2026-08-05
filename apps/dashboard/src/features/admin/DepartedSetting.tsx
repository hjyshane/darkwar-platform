import { useQuery } from '@tanstack/react-query';
import { type DepartureRow, fetchDepartures } from '../roster/RosterPanel';

/**
 * Who has left the alliance, on the admin screen rather than the roster.
 *
 * 0067 derives this from the newest al.rank batch, and it first shipped under
 * the members table. Wrong place: a departure is an administrative fact, and
 * putting it where everyone looks at the roster turns "so-and-so is gone"
 * into an announcement the alliance did not ask for. An officer needs it to
 * tidy up permissions; nobody else needs it at all.
 *
 * The query is shared with the roster module rather than copied, so the
 * `confirmed` rule stays in one place.
 */
export function DepartedSetting() {
  const { data, error, isPending } = useQuery({
    queryKey: ['departures'],
    queryFn: fetchDepartures,
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load departures: {error.message}</p>;
  }
  const rows = data ?? [];
  return (
    <>
      <p className="subtle">
        Members seen in an earlier capture and missing from the newest one. Marked{' '}
        <strong>unconfirmed</strong> when that capture did not cover the whole roster — an
        unscrolled member list looks exactly like somebody leaving, and six of this alliance's ten
        captured batches are a row or two short.
      </p>
      {rows.length === 0 ? (
        <p className="empty">Nobody has left since the collector started watching.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">HQ</th>
              <th scope="col">Power when last seen</th>
              <th scope="col">Last seen as a member</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: DepartureRow) => (
              <tr key={row.game_uid}>
                <td className="label">
                  {row.player_id === null ? (
                    (row.last_known_name ?? '—')
                  ) : (
                    <a href={`#/player/${row.player_id}`}>{row.last_known_name ?? '—'}</a>
                  )}
                  {row.confirmed === false && (
                    <span
                      className="badge"
                      title="The newest capture did not cover the whole roster"
                    >
                      unconfirmed
                    </span>
                  )}
                </td>
                <td className="num">{row.last_hq_level ?? '—'}</td>
                <td className="num">
                  {row.last_power === null ? '—' : row.last_power.toLocaleString('ko-KR')}
                </td>
                <td>{row.last_seen_in_alliance_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
