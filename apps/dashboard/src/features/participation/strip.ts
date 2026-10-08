// The figures at the head of the Participation screen, from the rows the report
// already holds. Pure, so what the strip claims can be checked on its own.
//
// The board-read counts are the same for every member (they are days the board
// was read for the alliance), so they come from the first row. A bar that is not
// set has no cell: no bar is not the same as nobody reaching it.

import type { Bars, ParticipationRow } from './data';

export interface StripCell {
  label: string;
  /** Already formatted; null shows as a dash. */
  value: string | null;
  note?: string;
}

const plain = new Intl.NumberFormat('en');
const unit = (count: number, word: string) =>
  `${plain.format(count)} ${word}${count === 1 ? '' : 's'}`;

export function participationStrip(rows: readonly ParticipationRow[], bars: Bars): StripCell[] {
  const first = rows[0];
  if (first === undefined) return [];
  const reached = (pick: (row: ParticipationRow) => number | null) =>
    rows.filter((row) => (pick(row) ?? 0) > 0).length;

  const cells: StripCell[] = [
    { label: 'Members', value: plain.format(rows.length) },
    {
      label: 'Duel board read',
      value: unit(first.duel_days_read, 'day'),
      note: `${unit(first.duel_weeks_read, 'week')} of weekly totals`,
    },
    {
      label: 'Donation board read',
      value: unit(first.donation_days_read, 'day'),
      note: `${unit(first.donation_weeks_read, 'week')} of weekly totals`,
    },
  ];
  if (bars.duel !== null) {
    cells.push({
      label: 'Reached the duel bar',
      value: `${plain.format(reached((row) => row.duel_days_over))} of ${plain.format(rows.length)}`,
      note: `${plain.format(bars.duel)} or more on a day`,
    });
  }
  if (bars.donation !== null) {
    cells.push({
      label: 'Reached the donation bar',
      value: `${plain.format(reached((row) => row.donation_days_over))} of ${plain.format(rows.length)}`,
      note: `${plain.format(bars.donation)} or more on a day`,
    });
  }
  return cells;
}
