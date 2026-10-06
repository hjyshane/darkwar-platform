import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { playerHash } from '../../lib/route';
import {
  type BoardFilter,
  type MigrationPerson,
  STATUS_LABEL,
  delta,
  fetchMigrationTopBoard,
  filterBoard,
} from './data';
import { num, power, signed, trend } from './format';

const FILTERS: ReadonlyArray<{ filter: BoardFilter; label: string }> = [
  { filter: 'all', label: 'All' },
  { filter: 'moved', label: STATUS_LABEL.moved },
  { filter: 'stayed', label: STATUS_LABEL.stayed },
  { filter: 'appeared', label: STATUS_LABEL.appeared },
  { filter: 'unseen_after', label: STATUS_LABEL.unseen_after },
];

function Route({ person }: { person: MigrationPerson }) {
  const from = person.before_server_id;
  const to = person.after_server_id;
  if (person.status === 'moved') {
    return (
      <span>
        {from} → <strong>{to}</strong>
      </span>
    );
  }
  return <span>{to ?? from ?? '—'}</span>;
}

function Alliance({ before, after }: { before: string | null; after: string | null }) {
  if (before === after || after === null) return <span>{before ?? '—'}</span>;
  if (before === null) return <span>{after}</span>;
  return (
    <span>
      <span className="muted">{before}</span> → {after}
    </span>
  );
}

export function MigrationTopBoard({ eventId }: { eventId: string }) {
  const [filter, setFilter] = useState<BoardFilter>('all');
  const board = useQuery({
    queryKey: ['migration', 'top', eventId],
    queryFn: () => fetchMigrationTopBoard(eventId),
    staleTime: 5 * 60_000,
  });

  if (board.isPending) return <p className="empty loading">Loading…</p>;
  if (board.error) return <p className="error">{board.error.message}</p>;
  if (board.data.length === 0) {
    return <p className="empty">No cross-server power board captured on either side yet.</p>;
  }

  const counts = new Map<BoardFilter, number>([['all', board.data.length]]);
  for (const p of board.data) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  const rows = filterBoard(board.data, filter);

  return (
    <>
      <Tabs
        label="Who"
        items={FILTERS.map((f) => ({
          id: f.filter,
          label: (
            <>
              {f.label} <span className="subtle">{num(counts.get(f.filter) ?? 0)}</span>
            </>
          ),
        }))}
        value={filter}
        onChange={setFilter}
      />

      <div className="table-wrap">
        <table className="compact migration-top">
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Rank
              </th>
              <th scope="col">Player</th>
              <th scope="col">Status</th>
              <th scope="col">Server</th>
              <th scope="col">Alliance</th>
              <th scope="col" className="numeric">
                Power
              </th>
              <th scope="col" className="numeric">
                Δ power
              </th>
              <th scope="col" className="numeric">
                Rank after
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const dPower = delta(p.before_power, p.after_power);
              const dRank = delta(p.after_rank, p.before_rank);
              return (
                <tr key={p.game_uid} className={`migration-${p.status}`}>
                  <td className="numeric">{num(p.before_rank)}</td>
                  <th scope="row" className="label">
                    <a href={playerHash(p.player_id)}>{p.name ?? p.game_uid}</a>
                    {p.home_server_id !== (p.after_server_id ?? p.before_server_id) && (
                      <span className="subtle"> · from {p.home_server_id}</span>
                    )}
                  </th>
                  <td>{STATUS_LABEL[p.status]}</td>
                  <td>
                    <Route person={p} />
                  </td>
                  <td>
                    <Alliance before={p.before_alliance} after={p.after_alliance} />
                  </td>
                  <td className="numeric" title={num(p.after_power ?? p.before_power)}>
                    {power(p.after_power ?? p.before_power)}
                  </td>
                  <td className={`numeric ${trend(dPower)}`}>{signed(dPower, power)}</td>
                  <td className="numeric">
                    {num(p.after_rank)}
                    {dRank !== null && dRank !== 0 && (
                      <span className={`subtle ${trend(dRank)}`}> ({signed(dRank)})</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Everyone on the cross-server power board on either side. Rank is before the baseline; rank
        after is the newest board since. “From” marks a player whose server is not the one their
        account was made on.
      </p>
    </>
  );
}
