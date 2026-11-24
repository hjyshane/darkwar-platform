// What sits around the guide's score lists: what is running right now, the
// best things to do in a theme, and the alliance's own event times. Pure, so
// each claim can be checked on its own; every clock is server time, UTC-2.

import { type Translate, english } from '../../lib/i18n/core';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { SLOT_HOURS, type ScoreSource, type Theme, actionText, scoresOf, slotStart } from './guide';

/** The theme the current Survival Preparedness slot runs, and when it hands
 * over. Null where the game has not told us what runs now. */
export function runningNow(
  grid: readonly (readonly (string | null)[])[],
  themes: readonly Theme[],
  here: { weekday: number; slot: number },
): { name: string; until: string } | null {
  const eventId = grid[here.slot - 1]?.[here.weekday - 1] ?? null;
  if (eventId === null) return null;
  const name = themes.find((theme) => theme.event_id === eventId)?.name ?? eventId;
  return { name, until: slotStart(here.slot + 1) };
}

/** The best things to do in one theme, as sentences: the first rows of
 * `scoresOf`, which is already best per unit first. */
export function bestActions(
  scores: readonly ScoreSource[],
  activity: string,
  eventId: string,
  count: number,
  t: Translate = english,
): string[] {
  return scoresOf(scores, activity, eventId)
    .slice(0, count)
    .map((row) => actionText(row.action, row.per_value, t));
}

export interface TimeRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export type TimeState = 'ahead' | 'running' | 'over';

/** Where an event the game told us about stands. With no end time a started
 * event is "over": we cannot say it is still running. */
export function timeState(row: TimeRow, now: Date): TimeState {
  const at = now.getTime();
  if (Date.parse(row.startsAt) > at) return 'ahead';
  if (row.endsAt !== null && Date.parse(row.endsAt) > at) return 'running';
  return 'over';
}

const DAY_MS = 86_400_000;

function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

/** The same instant on the reader's own clock, for showing in brackets beside
 * the server time: `13:30`, or `01:30 +1d` where their date is a day ahead of
 * the server's. Empty when it would only repeat the server time (the reader is
 * in the server's own zone), so the brackets are never noise. */
export function localHint(iso: string, localZone: string): string {
  const serverTime = zonedTime(iso, SERVER_ZONE);
  const localTime = zonedTime(iso, localZone);
  const shift = dayNumber(zonedDayKey(iso, localZone)) - dayNumber(zonedDayKey(iso, SERVER_ZONE));
  if (shift === 0 && localTime === serverTime) return '';
  if (shift === 0) return localTime;
  return `${localTime} ${shift > 0 ? '+' : '−'}${Math.abs(shift)}d`;
}

/** The local time a Survival Preparedness slot starts at today, from its
 * server-clock label. Slot 1 opens at 00:00 server time. */
export function slotLocalHint(slot: number, now: Date, localZone: string): string {
  const [year, month, day] = zonedDayKey(now.toISOString(), SERVER_ZONE).split('-').map(Number);
  const serverHour = (slot - 1) * SLOT_HOURS;
  // Server time is UTC-2, so the same instant is two hours later in UTC.
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, serverHour + 2));
  return localHint(at.toISOString(), localZone);
}
