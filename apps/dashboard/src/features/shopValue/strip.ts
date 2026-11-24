// The figures at the head of the Shop value screen, from the packs already
// loaded. Pure, so what the strip claims can be checked on its own.
//
// Only packs on sale now count, and an offer the game issued under several ids
// counts once (`groupPacks`). A pack the game's screens do not sell on this
// server - another stage's version, another server's pass - is not on sale
// here (`foldVariants`, with no officer choices: the strip never hid those). A pack with no value ratio (a battle pass, a login
// gift) is never the best value and is left out of the average: no ratio is not
// a ratio of zero.

import type { StripCell } from '../../components/Strip';
import { type Translate, english } from '../../lib/i18n/core';
import { humanUntil } from '../../lib/shellNav';
import { type PackValue, foldVariants, groupPacks, isInStore, ratioLabel } from './data';

const plain = new Intl.NumberFormat('en');

export function shopStrip(
  packs: ReadonlyArray<PackValue>,
  now: Date,
  t: Translate = english,
): StripCell[] {
  const live = foldVariants(
    groupPacks(packs.filter((pack) => isInStore(pack, now))),
    new Map(),
    false,
  ).rows;
  const rated = live.filter((pack) => pack.value_ratio !== null);
  const best = [...rated].sort((a, b) => (b.value_ratio ?? 0) - (a.value_ratio ?? 0))[0];
  const ending = live
    .filter((pack) => pack.ends_at !== null)
    .sort((a, b) => Date.parse(a.ends_at ?? '') - Date.parse(b.ends_at ?? ''))[0];
  const average =
    rated.length === 0
      ? null
      : rated.reduce((sum, pack) => sum + (pack.value_ratio ?? 0), 0) / rated.length;
  return [
    {
      label: t('On sale now'),
      value: plain.format(live.length),
      note: live.length === 1 ? t('offer') : t('offers'),
    },
    {
      label: t('Best value'),
      value: best === undefined ? null : best.name,
      note:
        best === undefined
          ? undefined
          : t('{ratio} for ${dollars}', {
              ratio: ratioLabel(best.value_ratio),
              dollars: plain.format(best.dollars),
            }),
    },
    {
      label: t('Ends next'),
      value: ending === undefined ? null : ending.name,
      note:
        ending?.ends_at == null
          ? undefined
          : t('in {time}', { time: humanUntil(Date.parse(ending.ends_at) - now.getTime(), t) }),
    },
    {
      label: t('Average value'),
      value: average === null ? null : ratioLabel(average),
      note:
        average === null
          ? undefined
          : t('over {count} with a ratio', { count: plain.format(rated.length) }),
    },
  ];
}
