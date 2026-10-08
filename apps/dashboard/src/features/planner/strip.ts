// The figures at the head of the planner: the three buffs every cost and time
// below is worked out with, and how many things are chosen.
//
// Pure, so what the header claims can be checked on its own. The buffs are the
// ones the arithmetic uses (the login's plus whatever the reader added on top);
// each says where its number came from, so a figure that differs from the game's
// is explained on the spot rather than looking wrong.

import type { Buffs } from './plan';

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

const pct = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const percent = (value: number) => `${pct.format(value)}%`;

function note(base: number, extra: number): string {
  return extra === 0
    ? 'from the login'
    : `${percent(base)} from the login, ${percent(extra)} added`;
}

export function plannerStrip(base: Buffs, extra: Buffs, chosen: number): StripCell[] {
  return [
    {
      label: 'Construction speed',
      value: percent(base.constructionSpeed + extra.constructionSpeed),
      note: note(base.constructionSpeed, extra.constructionSpeed),
    },
    {
      label: 'Research speed',
      value: percent(base.researchSpeed + extra.researchSpeed),
      note: note(base.researchSpeed, extra.researchSpeed),
    },
    {
      label: 'Construction cost',
      // A reduction is written as the change it makes to a cost.
      value:
        base.costReduction + extra.costReduction === 0
          ? '0%'
          : `−${percent(base.costReduction + extra.costReduction)}`,
      note: note(base.costReduction, extra.costReduction),
    },
    {
      label: 'Chosen to raise',
      value: String(chosen),
      note: chosen === 0 ? 'pick something below' : undefined,
    },
  ];
}
