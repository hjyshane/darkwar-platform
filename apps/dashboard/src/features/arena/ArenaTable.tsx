import { FreshnessBadge } from '../../components/FreshnessBadge';

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
        <span>{weekLabel} 주차</span> <FreshnessBadge capturedAt={header.captured_at} now={now} />
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">순위</th>
            <th scope="col">이름</th>
            <th scope="col">점수</th>
            <th scope="col">방어 전투력</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.snapshot_id}>
              <td>{entry.rank}</td>
              <td>{entry.name ?? `UID ${entry.game_uid}`}</td>
              <td>{entry.score === null ? '—' : numberFormat.format(entry.score)}</td>
              <td>
                {entry.defense_power === null ? '—' : numberFormat.format(entry.defense_power)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
