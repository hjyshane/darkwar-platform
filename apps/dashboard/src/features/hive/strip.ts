// The figures at the head of the Hive screen, from the formation and the board
// already loaded. Pure, so what the strip claims can be checked on its own.
//
// Only member bases count: a structure or a marker never carries a member, so
// counting it would make a finished plan read as half empty.

import type { Coordinate } from '@dw/ui';
import { formatTeleport, isMemberBase } from '../../lib/hiveFormation';
import { type Translate, english } from '../../lib/i18n/core';
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
  t: Translate = english,
): StripCell[] {
  const bases = board.filter(isMemberBase);
  const assigned = bases.filter((slot) => slot.playerId !== null).length;
  const empty = bases.length - assigned;
  return [
    {
      label: t('Plan'),
      value: formation.isActive ? t('Live') : t('Draft'),
      note: formation.isActive
        ? t('the one members are told to follow')
        : t('not an instruction yet'),
    },
    {
      label: t('Bases'),
      value: plain.format(bases.length),
      note: t('on server {server}', { server: formation.serverId }),
    },
    {
      label: t('Assigned'),
      value: t('{assigned} of {total}', {
        assigned: plain.format(assigned),
        total: plain.format(bases.length),
      }),
      note:
        empty === 0
          ? t('every base has a member')
          : t('{count} still empty', { count: plain.format(empty) }),
    },
    { label: t('Anchor'), value: formatTeleport(anchor) },
  ];
}
