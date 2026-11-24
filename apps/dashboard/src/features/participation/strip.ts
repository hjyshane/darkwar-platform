// The figures at the head of the Participation screen, from the rows the report
// already holds. Pure, so what the strip claims can be checked on its own.
//
// The board-read counts are the same for every member (they are days the board
// was read for the alliance), so they come from the first row. A bar that is not
// set has no cell: no bar is not the same as nobody reaching it.

import { type Translate, english } from '../../lib/i18n/core';
import type { Bars, ParticipationRow } from './data';

export interface StripCell {
  label: string;
  /** Already formatted; null shows as a dash. */
  value: string | null;
  note?: string;
}

const plain = new Intl.NumberFormat('en');
export function participationStrip(
  rows: readonly ParticipationRow[],
  bars: Bars,
  t: Translate = english,
): StripCell[] {
  const days = (count: number) =>
    count === 1
      ? t('{count} day', { count: plain.format(count) })
      : t('{count} days', { count: plain.format(count) });
  const weeks = (count: number) =>
    count === 1
      ? t('{count} week of weekly totals', { count: plain.format(count) })
      : t('{count} weeks of weekly totals', { count: plain.format(count) });
  const first = rows[0];
  if (first === undefined) return [];
  const reached = (pick: (row: ParticipationRow) => number | null) =>
    rows.filter((row) => (pick(row) ?? 0) > 0).length;

  const cells: StripCell[] = [
    { label: t('Members'), value: plain.format(rows.length) },
    {
      label: t('Duel board read'),
      value: days(first.duel_days_read),
      note: weeks(first.duel_weeks_read),
    },
    {
      label: t('Donation board read'),
      value: days(first.donation_days_read),
      note: weeks(first.donation_weeks_read),
    },
  ];
  if (bars.duel !== null) {
    cells.push({
      label: t('Reached the duel bar'),
      value: t('{count} of {total}', {
        count: plain.format(reached((row) => row.duel_days_over)),
        total: plain.format(rows.length),
      }),
      note: t('{bar} or more on a day', { bar: plain.format(bars.duel) }),
    });
  }
  if (bars.donation !== null) {
    cells.push({
      label: t('Reached the donation bar'),
      value: t('{count} of {total}', {
        count: plain.format(reached((row) => row.donation_days_over)),
        total: plain.format(rows.length),
      }),
      note: t('{bar} or more on a day', { bar: plain.format(bars.donation) }),
    });
  }
  return cells;
}
