// The figures at the head of the Gift codes page, from the code and member rows
// already loaded. Pure, so what the strip claims can be checked on its own.
//
// "Waiting" and "failed" count only codes that can still be claimed: a retired
// code's leftovers are history, not work in hand.

import type { GiftCode, GiftMember } from './data';
import { isLive, summarise } from './status';

export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

const plain = new Intl.NumberFormat('en');

export function giftStrip(codes: readonly GiftCode[], members: readonly GiftMember[]): StripCell[] {
  const live = codes.filter(isLive);
  const sums = live.map(summarise);
  const waiting = sums.reduce((total, one) => total + one.waiting, 0);
  const failed = sums.reduce((total, one) => total + one.failed, 0);
  const claimed = members.filter((member) => !member.excluded).length;
  const leftOut = members.length - claimed;
  return [
    {
      label: 'Live codes',
      value: plain.format(live.length),
      note: live.length === codes.length ? 'all of them' : `of ${plain.format(codes.length)} added`,
    },
    {
      label: 'Claimed for',
      value: plain.format(claimed),
      note: leftOut === 0 ? 'the whole roster' : `${plain.format(leftOut)} left out`,
    },
    {
      label: 'Waiting',
      value: plain.format(waiting),
      note: 'sent one at a time',
    },
    {
      label: 'Failed',
      value: plain.format(failed),
      note: failed === 0 ? 'none on a live code' : 'on live codes',
    },
  ];
}
