// The figures at the head of the Game calendar screen, for the server on show.
// Pure, so what the strip claims can be checked on its own.
//
// Only events with a real window count as running or coming: a standing feature
// (ends in 2044) is part of the game, not an event, and an untimed one has no
// window to be inside. `arrange` already draws those lines.

import type { StripCell } from '../../components/Strip';
import { type Translate, english } from '../../lib/i18n/core';
import { type CalendarEvent, arrange, labelOf, serverWhen, until } from './data';

const plain = new Intl.NumberFormat('en');

export function calendarStrip(
  events: ReadonlyArray<CalendarEvent>,
  now: Date,
  t: Translate = english,
): StripCell[] {
  const { live, upcoming } = arrange(events, now);
  const endsNext = live[0];
  const startsNext = upcoming[0];
  return [
    {
      label: t('Running now'),
      value: plain.format(live.length),
      note: t('standing features are not counted'),
    },
    {
      label: t('Ends next'),
      value: endsNext === undefined ? null : labelOf(endsNext, t),
      note:
        endsNext?.ends_at == null
          ? undefined
          : t('in {time}', { time: until(endsNext.ends_at, now, t) }),
    },
    {
      label: t('Starts next'),
      value: startsNext === undefined ? null : labelOf(startsNext, t),
      note:
        startsNext?.starts_at == null
          ? undefined
          : `${serverWhen(startsNext.starts_at, now)} \u00b7 ${t('in {time}', { time: until(startsNext.starts_at, now, t) })}`,
    },
    {
      label: t('Announced ahead'),
      value: plain.format(upcoming.length),
      note: t('not started yet'),
    },
  ];
}
