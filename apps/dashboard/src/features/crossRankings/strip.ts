// The figures at the head of the Player Ranking screen: the board on show and
// where its players are from. Pure, so each claim can be checked on its own.

import type { StripCell } from '../../components/Strip';
import { formatAge } from '../../lib/freshness';
import type { BoardRow } from './boards';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

export function boardStrip(rows: readonly BoardRow[], valueLabel: string, now: Date): StripCell[] {
  if (rows.length === 0) return [];
  const perServer = new Map<number, number>();
  for (const row of rows) perServer.set(row.server_id, (perServer.get(row.server_id) ?? 0) + 1);
  // Most players first; the lower server number settles a tie, so the answer does
  // not depend on the order the rows came in.
  const [busiest] = [...perServer].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  // The ranked first: the lowest rank number, not whichever row happens to be first.
  const top = [...rows]
    .filter((row) => row.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0];
  const newest = rows
    .map((row) => row.captured_at)
    .sort()
    .at(-1);
  return [
    {
      label: 'Players',
      value: plain.format(rows.length),
      note: `from ${plain.format(perServer.size)} ${perServer.size === 1 ? 'server' : 'servers'}`,
    },
    {
      label: 'Top',
      value: top === undefined ? null : (top.name ?? `UID ${top.game_uid}`),
      note:
        top?.value == null ? undefined : `${valueLabel.toLowerCase()} ${compact.format(top.value)}`,
    },
    {
      label: 'Most on the board',
      value: busiest === undefined ? null : `Server ${busiest[0]}`,
      note: busiest === undefined ? undefined : `${plain.format(busiest[1])} players`,
    },
    {
      label: 'Newest capture',
      value: newest === undefined ? null : formatAge(newest, now),
    },
  ];
}

/** The strip for a board the database pages (0263): the same four claims as
 * `boardStrip`, from per-server counts and the first-ranked row, because the
 * rows themselves are never all in the browser. */
export function remoteStrip(
  servers: readonly { id: number; count: number; newest: string | null }[],
  top: BoardRow | undefined,
  valueLabel: string,
  now: Date,
): StripCell[] {
  const players = servers.reduce((sum, server) => sum + server.count, 0);
  if (players === 0) return [];
  const [busiest] = [...servers].sort((a, b) => b.count - a.count || a.id - b.id);
  const newest = servers
    .map((server) => server.newest)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  return [
    {
      label: 'Players',
      value: plain.format(players),
      note: `from ${plain.format(servers.length)} ${servers.length === 1 ? 'server' : 'servers'}`,
    },
    {
      label: 'Top',
      value: top === undefined ? null : (top.name ?? `UID ${top.game_uid}`),
      note:
        top?.value == null ? undefined : `${valueLabel.toLowerCase()} ${compact.format(top.value)}`,
    },
    {
      label: 'Most on the board',
      value: busiest === undefined ? null : `Server ${busiest.id}`,
      note: busiest === undefined ? undefined : `${plain.format(busiest.count)} players`,
    },
    {
      label: 'Newest capture',
      value: newest === undefined ? null : formatAge(newest, now),
    },
  ];
}
