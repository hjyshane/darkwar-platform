// The figures at the head of the Arena screen, for the league on show. Pure, so
// what the strip claims can be checked on its own.
//
// The average defence power leaves out entries with no figure: a missing reading
// is not a defence of zero.

import type { StripCell } from '../../components/Strip';
import { formatAge } from '../../lib/freshness';
import type { ArenaEntryRow, ArenaHeader } from './ArenaTable';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

export function arenaStrip(
  header: Pick<ArenaHeader, 'captured_at' | 'week_start'>,
  entries: readonly ArenaEntryRow[],
  now: Date,
): StripCell[] {
  const top = [...entries].sort((a, b) => a.rank - b.rank)[0];
  const defences = entries.flatMap((entry) =>
    entry.defense_power === null ? [] : [entry.defense_power],
  );
  const average =
    defences.length === 0
      ? null
      : defences.reduce((sum, value) => sum + value, 0) / defences.length;
  return [
    { label: 'Players', value: plain.format(entries.length), note: 'on this league board' },
    {
      label: 'Top',
      value: top === undefined ? null : (top.name ?? `UID ${top.game_uid}`),
      note: top?.score == null ? undefined : `score ${plain.format(top.score)}`,
    },
    {
      label: 'Average defence',
      value: average === null ? null : compact.format(average),
      note: 'power, over those with a figure',
    },
    {
      label: 'Captured',
      value: formatAge(header.captured_at, now),
      note: `week of ${header.week_start.slice(0, 10)}`,
    },
  ];
}
