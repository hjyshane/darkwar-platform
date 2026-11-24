import { describe, expect, it } from 'vitest';
import { FALLBACK_TRACKED_SERVERS, trackedOrFallback } from './trackedServers';

describe('trackedOrFallback', () => {
  it('lists the servers the database marks as tracked, in order', () => {
    expect(trackedOrFallback([590, 565, 577])).toEqual([565, 577, 590]);
  });

  it('stands in the 565-588 group while there is no answer, or an empty one', () => {
    for (const none of [undefined, null, []]) {
      expect(trackedOrFallback(none)).toBe(FALLBACK_TRACKED_SERVERS);
    }
    expect(FALLBACK_TRACKED_SERVERS[0]).toBe(565);
    expect(FALLBACK_TRACKED_SERVERS.at(-1)).toBe(588);
    expect(FALLBACK_TRACKED_SERVERS).toHaveLength(24);
  });
});
