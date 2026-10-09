// The figures at the head of the Alliance Ranking screen, from the rows already
// loaded. Pure, so what the strip claims can be checked on its own.
//
// A row with no power is not the strongest and adds nothing to the total: no
// reading is not a reading of zero.

import type { StripCell } from '../../components/Strip';
import { formatAge } from '../../lib/freshness';
import type { AllianceRankingRow } from './AllianceRankingTable';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

export function allianceStrip(rows: readonly AllianceRankingRow[], now: Date): StripCell[] {
  if (rows.length === 0) return [];
  const servers = new Set(rows.map((row) => row.server_id)).size;
  let strongest: AllianceRankingRow | null = null;
  let total: number | null = null;
  for (const row of rows) {
    if (row.power === null) continue;
    total = (total ?? 0) + row.power;
    if (strongest === null || row.power > (strongest.power ?? 0)) strongest = row;
  }
  const newest = rows
    .map((row) => row.captured_at)
    .sort()
    .at(-1);
  return [
    {
      label: 'Alliances',
      value: plain.format(rows.length),
      note: `on ${plain.format(servers)} ${servers === 1 ? 'server' : 'servers'}`,
    },
    {
      label: 'Strongest',
      value:
        strongest === null
          ? null
          : `${strongest.code ? `[${strongest.code}] ` : ''}${strongest.name ?? 'Unnamed'}`,
      note: strongest?.power == null ? undefined : `${compact.format(strongest.power)} power`,
    },
    {
      label: 'Combined power',
      value: total === null ? null : compact.format(total),
      note: 'as the game reports it',
    },
    {
      label: 'Newest capture',
      value: newest === undefined ? null : formatAge(newest, now),
    },
  ];
}
