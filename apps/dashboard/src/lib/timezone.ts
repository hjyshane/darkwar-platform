/** Which clock the reader wants the calendar drawn against.
 *
 * A DISPLAY PREFERENCE AND NOTHING ELSE. Every instant is stored as
 * `timestamptz` and every reminder fires at the instant it was set for; picking
 * a zone here changes how a moment is written down, never when it happens. Two
 * members in Seoul and Paris looking at the same entry see different clock
 * faces and turn up at the same time.
 *
 * Per browser, like the theme, rather than per account. It is a property of
 * where somebody is sitting, not of who they are — the same person on a laptop
 * at home and a phone abroad wants different answers, and a column on
 * `app_users` would give them one.
 *
 * NO LIBRARY. `Intl` already ships every rule a browser knows about, including
 * the ones that change when a government moves a boundary. A date library here
 * would be 20 kB to restate that badly.
 */

const KEY = 'dw-timezone';

/** The clock the GAME shows, and the default for everybody.
 *
 * `Etc/GMT+2` is UTC−2. The sign is inverted in the `Etc/` names — POSIX chose
 * "hours west of Greenwich" and IANA kept it — so this reads backwards and is
 * right. It is spelled once, here, for that reason.
 *
 * DEFAULT RATHER THAN THE BROWSER'S ZONE, which is a deliberate reversal of
 * what shipped an hour ago. The times on this calendar are copied out of the
 * game, and the game shows server time; a member reading "20:00" wants that to
 * be the 20:00 they will see in the client, not a number they have to convert
 * before they can act on it. Anybody who would rather see their own clock has
 * the picker, and their choice sticks.
 *
 * It also explains the odd constant this repo has carried from the start: the
 * game week resets at 02:00 UTC, which is midnight server time. The game
 * resets at midnight; only the write-down was strange.
 */
export const SERVER_ZONE = 'Etc/GMT+2';

/** The zone the machine is set to, which is the right default: somebody who
 *  has never touched this setting means "my time". */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Zones offered in the picker, before the reader's own is folded in.
 *
 * A SHORT LIST ON PURPOSE. The full IANA set is about 400 entries and picking
 * from it is worse than typing. These are UTC, the zones this alliance actually
 * spans, and a few neighbours — anybody outside them still gets their own zone
 * as the default, added to the list by `zoneOptions`.
 */
const OFFERED: readonly string[] = [
  SERVER_ZONE,
  'UTC',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Manila',
  'Asia/Ho_Chi_Minh',
  'Asia/Phnom_Penh',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Europe/Paris',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

/** The list to draw, with the reader's own zone included wherever it sits. */
export function zoneOptions(current: string): string[] {
  const own = browserZone();
  const all = [...OFFERED];
  for (const zone of [own, current]) {
    if (zone !== '' && !all.includes(zone)) {
      all.push(zone);
    }
  }
  return all;
}

export function readZone(): string {
  try {
    const stored = localStorage.getItem(KEY);
    // Anything unrecognised — a renamed zone, a hand-edited value — falls back
    // rather than throwing on every format call afterwards.
    return stored !== null && isZone(stored) ? stored : SERVER_ZONE;
  } catch {
    return SERVER_ZONE;
  }
}

export function storeZone(zone: string): void {
  try {
    localStorage.setItem(KEY, zone);
  } catch {
    // A choice that does not survive a reload still works for this visit.
  }
}

function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function partsIn(instant: Date, zone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      // `hour` comes back as 24 at midnight under hour12: false in some
      // engines, which would roll the date forward a day if left alone.
      out[part.type] = Number(part.value) % (part.type === 'hour' ? 24 : Number.POSITIVE_INFINITY);
    }
  }
  return out;
}

/** How far `zone` is from UTC at that instant, in ms. Positive east of UTC.
 *
 * Computed per instant rather than once, because the answer changes twice a
 * year for about half the world — Paris is +1 in January and +2 in July, and a
 * cached offset puts every summer entry an hour out.
 */
function offsetMs(instant: Date, zone: string): number {
  const p = partsIn(instant, zone);
  const wall = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  // FLOORED TO THE SECOND on both sides. `partsIn` cannot report milliseconds,
  // so `wall` is second-precision while `instant` is not — and subtracting them
  // raw leaves the millisecond remainder in the answer. It is invisible in
  // arithmetic (a few hundred ms either way) and very visible in a label:
  // "Asia/Seoul (UTC+8:59.99223333333339)" is what the picker showed, because
  // `new Date()` in a browser has milliseconds and the fixtures in the test did
  // not.
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** `2026-08-21` — which DAY this instant falls on, in that zone.
 *
 * THE FUNCTION THE GRID DEPENDS ON. An entry at 20:00 UTC is the 21st in Seoul
 * and the 20th in London; bucketing by the UTC date instead would draw it in
 * the wrong cell for everybody east of the meridian, while the time printed
 * inside the cell looked right.
 */
export function zonedDayKey(iso: string, zone: string): string {
  const p = partsIn(new Date(iso), zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${p.year ?? 1970}-${pad(p.month ?? 1)}-${pad(p.day ?? 1)}`;
}

/** `20:00` in that zone. */
export function zonedTime(iso: string, zone: string): string {
  const p = partsIn(new Date(iso), zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(p.hour ?? 0)}:${pad(p.minute ?? 0)}`;
}

/** What `<input type="datetime-local">` wants, in that zone. */
export function toInputValue(iso: string | null, zone: string): string {
  if (iso === null) {
    return '';
  }
  return `${zonedDayKey(iso, zone)}T${zonedTime(iso, zone)}`;
}

/** The reverse: a wall clock the reader typed, as an instant.
 *
 * TWO PASSES, and the second is not superstition. The offset depends on the
 * instant, and the instant is what is being solved for — so the first pass uses
 * the offset at the naive guess and the second corrects it. That matters
 * exactly once a year per zone, in the hour after a clock goes back, where the
 * first guess lands on the wrong side of the change.
 *
 * A time inside a spring-forward gap does not exist. It resolves to the instant
 * an hour later rather than throwing: the reader typed something impossible for
 * their own zone and the useful answer is the moment they meant.
 */
export function fromInputValue(value: string, zone: string): string | null {
  if (value.trim() === '') {
    return null;
  }
  const naive = new Date(`${value}:00Z`).getTime();
  if (Number.isNaN(naive)) {
    return null;
  }
  let instant = naive - offsetMs(new Date(naive), zone);
  instant = naive - offsetMs(new Date(instant), zone);
  return new Date(instant).toISOString();
}

/** `Asia/Seoul (UTC+9)`, for the picker. */
export function zoneLabel(zone: string, now: Date = new Date()): string {
  // Named rather than spelled. "Etc/GMT+2" in a dropdown is a puzzle — it looks
  // like UTC+2 and is UTC−2 — and nobody picking a clock for a game calendar is
  // looking for an IANA identifier.
  if (zone === SERVER_ZONE) {
    return 'Server time (UTC−2)';
  }
  const minutes = offsetMs(now, zone) / 60_000;
  if (minutes === 0) {
    return zone === 'UTC' ? 'UTC' : `${zone} (UTC)`;
  }
  const sign = minutes > 0 ? '+' : '−';
  const whole = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const offset = rest === 0 ? `${whole}` : `${whole}:${String(rest).padStart(2, '0')}`;
  return `${zone} (UTC${sign}${offset})`;
}
