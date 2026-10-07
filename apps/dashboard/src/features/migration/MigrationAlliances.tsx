import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type MigrationAlliance, delta, fetchMigrationAlliances } from './data';
import { num, power, signed, trend } from './format';

function label(a: MigrationAlliance): string {
  if (a.code && a.name) return `[${a.code}] ${a.name}`;
  return a.name ?? a.code ?? a.external_id.slice(0, 8);
}

function ServerCell({ a }: { a: MigrationAlliance }) {
  const before = a.before_server_id;
  const after = a.after_server_id;
  if (before !== null && after !== null && before !== after) {
    return (
      <span>
        {before} → <strong>{after}</strong>
      </span>
    );
  }
  return <span>{after ?? before ?? '—'}</span>;
}

/** Only alliances whose roster we read on at least one side say who left and
 * who joined; the rest are board figures alone. */
function hasRoster(a: MigrationAlliance): boolean {
  return a.roster_before_at !== null || a.roster_after_at !== null;
}

export function MigrationAlliances({ eventId }: { eventId: string }) {
  const [rostersOnly, setRostersOnly] = useState(true);
  const alliances = useQuery({
    queryKey: ['migration', 'alliances', eventId],
    queryFn: () => fetchMigrationAlliances(eventId),
    staleTime: 5 * 60_000,
  });

  if (alliances.isPending) return <p className="empty loading">Loading…</p>;
  if (alliances.error) return <p className="error">{alliances.error.message}</p>;

  const rows = rostersOnly ? alliances.data.filter(hasRoster) : alliances.data;
  return (
    <>
      <label className="migration-toggle">
        <input
          type="checkbox"
          checked={rostersOnly}
          onChange={(e) => setRostersOnly(e.target.checked)}
        />{' '}
        Only alliances whose roster we opened
      </label>

      {rows.length === 0 ? (
        <p className="empty">
          {rostersOnly
            ? 'No alliance roster was opened within 14 days before the baseline, or since.'
            : 'No alliance captured on either side yet.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="compact migration-alliances">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Alliance
                </th>
                <th scope="col" rowSpan={2}>
                  Server
                </th>
                <th scope="colgroup" colSpan={3}>
                  Members
                </th>
                <th scope="colgroup" colSpan={3}>
                  Power
                </th>
                <th scope="colgroup" colSpan={3}>
                  Roster churn
                </th>
              </tr>
              <tr>
                <th scope="col" className="numeric">
                  Before
                </th>
                <th scope="col" className="numeric">
                  After
                </th>
                <th scope="col" className="numeric">
                  Δ
                </th>
                <th scope="col" className="numeric">
                  Before
                </th>
                <th scope="col" className="numeric">
                  After
                </th>
                <th scope="col" className="numeric">
                  Δ
                </th>
                <th scope="col" className="numeric">
                  Left
                </th>
                <th scope="col" className="numeric" title="left the server, not just the alliance">
                  of them moved
                </th>
                <th scope="col" className="numeric">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                // The roster is the alliance's own list; the board figure
                // stands in where the roster was not read on that side.
                const membersBefore = a.members_before ?? a.board_members_before;
                const membersAfter = a.members_after ?? a.board_members_after;
                const powerBefore = a.board_power_before ?? a.roster_power_before;
                const powerAfter = a.board_power_after ?? a.roster_power_after;
                const dMembers = delta(membersBefore, membersAfter);
                const dPower = delta(powerBefore, powerAfter);
                return (
                  <tr key={a.external_id}>
                    <th scope="row" className="label">
                      {label(a)}
                    </th>
                    <td>
                      <ServerCell a={a} />
                    </td>
                    <td className="numeric">{num(membersBefore)}</td>
                    <td className="numeric">{num(membersAfter)}</td>
                    <td className={`numeric ${trend(dMembers)}`}>{signed(dMembers)}</td>
                    <td className="numeric">{power(powerBefore)}</td>
                    <td className="numeric">{power(powerAfter)}</td>
                    <td className={`numeric ${trend(dPower)}`}>{signed(dPower, power)}</td>
                    <td className="numeric">{num(a.left_alliance)}</td>
                    <td className="numeric">{num(a.left_by_moving)}</td>
                    <td className="numeric">{num(a.joined)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Members and power come from the alliance board where the alliance is on it, and from its
        roster otherwise. Churn needs the roster read on both sides; “of them moved” counts leavers
        who were later seen on another server. An alliance that changed server is one row.
      </p>
    </>
  );
}
