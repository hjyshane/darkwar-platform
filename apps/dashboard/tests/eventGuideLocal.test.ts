import { describe, expect, it } from 'vitest';
import { localHint, slotLocalHint } from '../src/features/eventGuide/extras';
import { SERVER_ZONE } from '../src/lib/timezone';

describe('localHint', () => {
  // 11:30 server time (UTC-2) is 13:30 UTC and 22:30 in Seoul (UTC+9), the same day.
  const iso = '2026-10-11T13:30:00Z';

  it("gives the reader's clock when it differs from the server's", () => {
    expect(localHint(iso, 'Asia/Seoul')).toBe('22:30');
  });

  it('is empty for a reader in the server zone, where brackets would only repeat it', () => {
    expect(localHint(iso, SERVER_ZONE)).toBe('');
  });

  it('says when the reader is a day ahead of the server', () => {
    // 20:00 server is 22:00 UTC and 07:00 the next day in Seoul.
    expect(localHint('2026-10-11T22:00:00Z', 'Asia/Seoul')).toBe('07:00 +1d');
  });

  it('says when the reader is a day behind the server', () => {
    // 01:00 server is 03:00 UTC, which is 20:00 the day before in Los Angeles (PDT, UTC-7).
    expect(localHint('2026-10-11T03:00:00Z', 'America/Los_Angeles')).toBe('20:00 −1d');
  });

  it('keeps the same date for a reader in a zone with the same date as the server', () => {
    // 12:00 server is 14:00 UTC, which is 14:00 in London in winter (UTC+0).
    expect(localHint('2026-12-11T14:00:00Z', 'Europe/London')).toBe('14:00');
  });
});

describe('slotLocalHint', () => {
  it('converts the start of a slot, which opens on a four-hour boundary of server time', () => {
    // Server day 2026-10-11; slot 4 opens 12:00 server = 14:00 UTC = 23:00 Seoul.
    const now = new Date('2026-10-11T15:00:00Z');
    expect(slotLocalHint(4, now, 'Asia/Seoul')).toBe('23:00');
  });

  it('marks a slot whose local start falls on the next date', () => {
    const now = new Date('2026-10-11T15:00:00Z');
    // Slot 6 opens 20:00 server = 22:00 UTC = 07:00 the next day in Seoul.
    expect(slotLocalHint(6, now, 'Asia/Seoul')).toBe('07:00 +1d');
  });
});
