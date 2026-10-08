// The figures at the head of the Members screen, taken from the rows the table
// already holds. Pure, so what the strip claims can be checked on its own.
//
// A dash means "not known". Power summed over some members is a figure about
// those members, so when some rows have no power the note says how many were
// counted rather than letting the total pass for the whole roster.

import type { RosterRow } from './RosterTable';

export interface StripCell {
  label: string;
  /** Already formatted; null shows as a dash. */
  value: string | null;
  note?: string;
  /** Only for a signed change: the sign is on screen either way. */
  tone?: 'up' | 'down' | 'flat';
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en');

const known = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

/** A member's growth is already a percentage (the table prints it as one), so
 * the roster's figure is the median of them, not a sum: the middle member, which
 * one very large account cannot drag. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** `+1.2%`, the way the table writes it. */
function percent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)}%`;
}

/** Members, their power, how a typical member's moved in a week, who is under
 * the minimum, who is online. Rows without a figure are left out of that figure and counted in
 * its note. */
export function rosterStrip(rows: readonly RosterRow[]): StripCell[] {
  const power = known(rows.map((row) => row.power));
  const growth = known(rows.map((row) => row.growth_7d));
  const onlineKnown = rows.filter((row) => row.online_state !== null);
  const below = rows.filter((row) => row.below_minimum === true).length;
  const middle = growth.length === 0 ? 0 : median(growth);

  const cells: StripCell[] = [
    { label: 'Members', value: plain.format(rows.length) },
    {
      label: 'Power',
      value: power.length === 0 ? null : compact.format(power.reduce((sum, v) => sum + v, 0)),
      note: power.length === rows.length ? undefined : `${power.length} of ${rows.length} counted`,
    },
    {
      label: 'Typical growth, 7 days',
      value: growth.length === 0 ? null : percent(middle),
      note:
        growth.length === rows.length
          ? 'median member'
          : `median of ${growth.length} of ${rows.length}`,
      tone:
        growth.length === 0
          ? undefined
          : Math.round(middle * 10) / 10 > 0
            ? 'up'
            : Math.round(middle * 10) / 10 < 0
              ? 'down'
              : 'flat',
    },
  ];
  if (below > 0) {
    cells.push({
      label: 'Under the minimum',
      value: plain.format(below),
      note: 'rank stepped down once',
    });
  }
  if (onlineKnown.length > 0) {
    cells.push({
      label: 'Online now',
      value: plain.format(onlineKnown.filter((row) => row.online_state === 'online').length),
    });
  }
  return cells;
}
