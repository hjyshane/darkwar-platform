import { describe, expect, it } from 'vitest';
import { type ServerMove, serverPath } from './serverPath';

const move = (
  fromServerId: number,
  toServerId: number,
  seenAt: string,
  lastSeenFromAt: string | null = null,
): ServerMove => ({ fromServerId, toServerId, seenAt, lastSeenFromAt });

describe('serverPath', () => {
  it('is the current server alone when nothing was recorded', () => {
    expect(serverPath([], 580)).toEqual({
      homeServerId: 580,
      stops: [{ serverId: 580, arrivedBy: null, leftPreviousAfter: null, current: true }],
      moved: false,
    });
  });

  it('starts from the first move origin and marks the newest stop current', () => {
    const path = serverPath(
      [
        move(571, 580, '2026-11-03T00:00:00Z', '2026-11-01T00:00:00Z'),
        move(580, 575, '2027-02-10T00:00:00Z'),
      ],
      575,
    );
    expect(path.homeServerId).toBe(571);
    expect(path.moved).toBe(true);
    expect(path.stops.map((s) => [s.serverId, s.current])).toEqual([
      [571, false],
      [580, false],
      [575, true],
    ]);
    expect(path.stops[1]).toMatchObject({
      arrivedBy: '2026-11-03T00:00:00Z',
      leftPreviousAfter: '2026-11-01T00:00:00Z',
    });
  });

  it('keeps a return home as its own stop', () => {
    const path = serverPath(
      [move(571, 580, '2026-11-03T00:00:00Z'), move(580, 571, '2027-02-10T00:00:00Z')],
      571,
    );
    expect(path.stops.map((s) => s.serverId)).toEqual([571, 580, 571]);
    expect(path.homeServerId).toBe(571);
  });
});
