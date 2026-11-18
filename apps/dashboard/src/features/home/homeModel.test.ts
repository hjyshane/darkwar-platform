import { describe, expect, it } from 'vitest';
import type { Theme } from '../eventGuide/guide';
import { blackGoldLine, nextBlackGold, todaysDuel } from './homeModel';

const theme = (day: number, name: string): Theme => ({
  activity_id: '70005',
  event_id: `e${day}`,
  day,
  name,
  name_ko: null,
  min_day_score: null,
  min_week_score: null,
});

describe('Home', () => {
  it("names today's Duel theme in server time, and none on Sunday", () => {
    const themes = [theme(1, 'Radar Training'), theme(3, 'Age of Science')];
    // Wed 2026-11-18 12:00 UTC is Wed 10:00 server time (UTC-2).
    expect(todaysDuel(themes, new Date('2026-11-18T12:00:00Z'))).toEqual({
      day: 3,
      name: 'Age of Science',
    });
    // Mon 01:00 UTC is still Sunday 23:00 server time.
    expect(todaysDuel(themes, new Date('2026-11-23T01:00:00Z'))).toBeNull();
    // A Duel day whose theme was never read.
    expect(todaysDuel(themes, new Date('2026-11-17T12:00:00Z'))).toBeNull();
  });

  it('says where I am in the newest Black Gold signup', () => {
    expect(blackGoldLine({ team_index: 1, state: 1 }, '2026-11-16T13:00:00Z')).toBe(
      'You are on Team A, starter.',
    );
    expect(blackGoldLine({ team_index: 2, state: 2 }, '2026-11-16T13:00:00Z')).toBe(
      'You are on Team B, substitute.',
    );
    expect(blackGoldLine(null, '2026-11-16T13:00:00Z')).toMatch(/not on a team/);
    expect(blackGoldLine({ team_index: null, state: 0 }, '2026-11-16T13:00:00Z')).toMatch(
      /not on a team/,
    );
    expect(blackGoldLine(null, null)).toMatch(/No Black Gold signup/);
  });

  it("picks my team's next Black Gold time, ignoring past and other events", () => {
    const entries = [
      { title: 'Black Gold · Team B', startsAt: '2026-11-22T10:00:00Z' },
      { title: 'Black Gold · Team A', startsAt: '2026-11-15T19:00:00Z' },
      { title: 'Black Gold · Team A', startsAt: '2026-11-22T19:00:00Z' },
      { title: 'Zombie Siege', startsAt: '2026-11-19T19:00:00Z' },
    ];
    const now = new Date('2026-11-18T12:00:00Z');
    expect(nextBlackGold(entries, 1, now)?.startsAt).toBe('2026-11-22T19:00:00Z');
    expect(nextBlackGold(entries, null, now)?.title).toBe('Black Gold · Team B');
    expect(nextBlackGold([], 1, now)).toBeNull();
  });
});
