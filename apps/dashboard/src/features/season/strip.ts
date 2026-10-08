// The figures at the head of the Season screen: three or four numbers that say
// what the board under them holds, before the table says it row by row.
//
// Pure, so what the strip claims can be checked without a DOM. None of them is
// a new measurement: every figure is a count or the top row of what the board
// already fetched. A dash means "we do not know", never zero.

import { allianceLabel } from './boards';
import type { SeasonAllianceRow, SeasonPlayerRow } from './boards';
import { type BuildingGrid, buildingsBehind } from './buildings';

export interface StripCell {
  label: string;
  /** Already formatted; null shows as a dash. */
  value: string | null;
  note?: string;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en');

/** Members seen, buildings tracked, and who is under the floors the alliance set. */
export function buildingsStrip(
  grid: BuildingGrid,
  floors: ReadonlyMap<number, number>,
): StripCell[] {
  const cells: StripCell[] = [
    {
      label: 'Members seen',
      value: plain.format(grid.members.length),
      note:
        grid.rosterTotal === null
          ? undefined
          : `of ${plain.format(grid.rosterTotal)} in the roster`,
    },
    {
      label: 'Buildings',
      value: plain.format(grid.columns.length),
      note:
        grid.unnamedSeen > 0
          ? `${plain.format(grid.unnamedSeen)} more on the map, not named`
          : 'all named',
    },
  ];
  if (floors.size > 0) {
    const behind = grid.members.filter(
      (member) => buildingsBehind(member, grid.columns, floors).length > 0,
    ).length;
    cells.push({
      label: 'Under a floor',
      value: plain.format(behind),
      note: `of ${plain.format(grid.members.length)} seen`,
    });
  }
  return cells;
}

/** The alliances ranked, and who is first. */
export function allianceStrip(rows: readonly SeasonAllianceRow[]): StripCell[] {
  const top = [...rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0];
  return [
    { label: 'Alliances ranked', value: plain.format(rows.length) },
    {
      label: 'First',
      value: top === undefined ? null : (allianceLabel(top.name, top.abbr) ?? null),
      note: top?.score == null ? undefined : `${compact.format(top.score)} points`,
    },
  ];
}

/** The players ranked, and who is first. */
export function playerStrip(rows: readonly SeasonPlayerRow[]): StripCell[] {
  const top = [...rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0];
  return [
    { label: 'Players ranked', value: plain.format(rows.length) },
    {
      label: 'First',
      value: top?.name ?? null,
      note: top?.force == null ? undefined : `${compact.format(top.force)} influence`,
    },
  ];
}
