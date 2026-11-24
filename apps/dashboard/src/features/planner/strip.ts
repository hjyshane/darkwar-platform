// The figures at the head of the planner: the three buffs every cost and time
// below is worked out with, and how many things are chosen.
//
// Pure, so what the header claims can be checked on its own. The buffs are the
// ones the arithmetic uses (the login's plus whatever the reader added on top);
// each says where its number came from, so a figure that differs from the game's
// is explained on the spot rather than looking wrong.

import { type Translate, english } from '../../lib/i18n/core';
import type { Buffs } from './plan';

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

const pct = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const percent = (value: number) => `${pct.format(value)}%`;

function note(base: number, extra: number, t: Translate): string {
  return extra === 0
    ? t('from the login')
    : t('{base} from the login, {extra} added', { base: percent(base), extra: percent(extra) });
}

export function plannerStrip(
  base: Buffs,
  extra: Buffs,
  chosen: number,
  t: Translate = english,
): StripCell[] {
  return [
    {
      label: t('Construction speed'),
      value: percent(base.constructionSpeed + extra.constructionSpeed),
      note: note(base.constructionSpeed, extra.constructionSpeed, t),
    },
    {
      label: t('Research speed'),
      value: percent(base.researchSpeed + extra.researchSpeed),
      note: note(base.researchSpeed, extra.researchSpeed, t),
    },
    {
      label: t('Construction cost'),
      // A reduction is written as the change it makes to a cost.
      value:
        base.costReduction + extra.costReduction === 0
          ? '0%'
          : `−${percent(base.costReduction + extra.costReduction)}`,
      note: note(base.costReduction, extra.costReduction, t),
    },
    {
      label: t('Chosen to raise'),
      value: String(chosen),
      note: chosen === 0 ? t('pick something below') : undefined,
    },
  ];
}
