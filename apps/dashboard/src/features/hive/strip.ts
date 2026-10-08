// The figures at the head of the Hive screen, from the formation and the board
// already loaded. Pure, so what the strip claims can be checked on its own.
//
// Only member bases count: a structure or a marker never carries a member, so
// counting it would make a finished plan read as half empty.

import type { Coordinate } from '@dw/ui';
import { formatTeleport, isMemberBase } from '../../lib/hiveFormation';
import type { BoardSlot, Formation } from './hiveFormations';

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

const plain = new Intl.NumberFormat('en');

export function hiveStrip(
  formation: Formation,
  board: readonly BoardSlot[],
  anchor: Coordinate,
): StripCell[] {
  const bases = board.filter(isMemberBase);
  const assigned = bases.filter((slot) => slot.playerId !== null).length;
  const empty = bases.length - assigned;
  return [
    {
      label: 'Plan',
      value: formation.isActive ? 'Live' : 'Draft',
      note: formation.isActive ? 'the one members are told to follow' : 'not an instruction yet',
    },
    { label: 'Bases', value: plain.format(bases.length), note: `on server ${formation.serverId}` },
    {
      label: 'Assigned',
      value: `${plain.format(assigned)} of ${plain.format(bases.length)}`,
      note: empty === 0 ? 'every base has a member' : `${plain.format(empty)} still empty`,
    },
    { label: 'Anchor', value: formatTeleport(anchor) },
  ];
}
