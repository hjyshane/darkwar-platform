// The figures at the head of the Shop value screen, from the packs already
// loaded. Pure, so what the strip claims can be checked on its own.
//
// Only packs on sale now count, and an offer the game issued under several ids
// counts once (`groupPacks`). A pack with no value ratio (a battle pass, a login
// gift) is never the best value and is left out of the average: no ratio is not
// a ratio of zero.

import type { StripCell } from '../../components/Strip';
import { humanUntil } from '../../lib/shellNav';
import { type PackValue, groupPacks, isLive, ratioLabel } from './data';

const plain = new Intl.NumberFormat('en');

export function shopStrip(packs: ReadonlyArray<PackValue>, now: Date): StripCell[] {
  const live = groupPacks(packs.filter((pack) => isLive(pack, now)));
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
      label: 'On sale now',
      value: plain.format(live.length),
      note: live.length === 1 ? 'offer' : 'offers',
    },
    {
      label: 'Best value',
      value: best === undefined ? null : best.name,
      note:
        best === undefined
          ? undefined
          : `${ratioLabel(best.value_ratio)} for $${plain.format(best.dollars)}`,
    },
    {
      label: 'Ends next',
      value: ending === undefined ? null : ending.name,
      note:
        ending?.ends_at == null
          ? undefined
          : `in ${humanUntil(Date.parse(ending.ends_at) - now.getTime())}`,
    },
    {
      label: 'Average value',
      value: average === null ? null : ratioLabel(average),
      note: average === null ? undefined : `over ${plain.format(rated.length)} with a ratio`,
    },
  ];
}
