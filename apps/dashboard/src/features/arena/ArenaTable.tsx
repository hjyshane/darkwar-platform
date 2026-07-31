import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TERMS } from '../../lib/terms';

export interface ArenaHeader {
  snapshot_id: string;
  week_start: string;
  captured_at: string;
  entry_count: number | null;
}

export interface ArenaEntryRow {
  snapshot_id: string;
  rank: number;
  name: string | null;
  game_uid: number;
  score: number | null;
  defense_power: number | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

export function ArenaTable({
  header,
  entries,
  now,
}: {
  header: ArenaHeader;
  entries: ArenaEntryRow[];
  now?: Date;
}) {
  const weekLabel = new Date(header.week_start).toISOString().slice(0, 10);
  return (
    <>
      <p>
        <span>Week {weekLabel}</span> <FreshnessBadge capturedAt={header.captured_at} now={now} />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num" scope="col">
                {TERMS.rank}
              </th>
              <th scope="col">{TERMS.name}</th>
              <th className="num" scope="col">
                {TERMS.score}
              </th>
              <th className="num" scope="col">
                {TERMS.defensePower}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.snapshot_id}>
                <td className="num">{entry.rank}</td>
                <td>{entry.name ?? `UID ${entry.game_uid}`}</td>
                <td className="num">
                  {entry.score === null ? '—' : numberFormat.format(entry.score)}
                </td>
                <td className="num">
                  {entry.defense_power === null ? '—' : numberFormat.format(entry.defense_power)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
