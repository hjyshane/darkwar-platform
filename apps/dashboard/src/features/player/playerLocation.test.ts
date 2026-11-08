import { describe, expect, it } from 'vitest';
import {
  LOCATION_MAX_AGE_MS,
  SHIELD_MAX_AGE_MS,
  formatCoordinate,
  shieldStateOf,
  stateOf,
} from './playerLocation';

const at = (capturedAt: string) => ({
  x: 491,
  y: 444,
  serverId: 581,
  capturedAt,
  shieldEndAt: null,
});
const NOW = new Date('2026-08-22T12:00:00Z');

describe('stateOf', () => {
  it('is unknown when nobody has swept that ground', () => {
    // The map is not a service: a tile exists only because the collector was
    // pointed at it. No sighting is the normal state for a server nobody
    // has visited, not an error.
    expect(stateOf(null, NOW)).toEqual({ kind: 'unknown' });
  });

  it('is known for a sighting inside the last day', () => {
    const state = stateOf(at('2026-08-22T02:00:00Z'), NOW);
    expect(state.kind).toBe('known');
  });

  it('goes stale the moment it passes a day', () => {
    // The boundary is the whole point of the feature, so it is asserted on
    // both sides rather than somewhere comfortably in the middle.
    const justInside = new Date(NOW.getTime() - LOCATION_MAX_AGE_MS + 1000).toISOString();
    const justOutside = new Date(NOW.getTime() - LOCATION_MAX_AGE_MS - 1000).toISOString();
    expect(stateOf(at(justInside), NOW).kind).toBe('known');
    expect(stateOf(at(justOutside), NOW).kind).toBe('stale');
  });

  it('keeps the coordinate when it goes stale', () => {
    // "Was at 491,444 three days ago" beats silence when you are deciding
    // where to look — as long as the screen does not call it current.
    const state = stateOf(at('2026-08-19T12:00:00Z'), NOW);
    expect(state.kind).toBe('stale');
    if (state.kind === 'stale') {
      expect(formatCoordinate(state.at)).toBe('491, 444');
      expect(state.at.serverId).toBe(581);
    }
  });
});

describe('shieldStateOf', () => {
  const sight = (capturedAt: string, shieldEndAt: string | null) => ({
    ...at(capturedAt),
    shieldEndAt,
  });

  it('is unknown with no sighting', () => {
    expect(shieldStateOf(null, NOW)).toEqual({ kind: 'unknown' });
  });

  it('is up while the shield end is in the future', () => {
    const state = shieldStateOf(sight('2026-08-22T11:00:00Z', '2026-08-22T15:00:00Z'), NOW);
    expect(state.kind).toBe('up');
  });

  it('is up from an old sighting too, because the end is still ahead', () => {
    // A shield that outlasts the reading has not ended whatever the age.
    const state = shieldStateOf(sight('2026-08-22T01:00:00Z', '2026-08-22T13:00:00Z'), NOW);
    expect(state.kind).toBe('up');
  });

  it('is down when the end has passed and the sighting is fresh', () => {
    const state = shieldStateOf(sight('2026-08-22T11:00:00Z', '2026-08-22T09:00:00Z'), NOW);
    expect(state).toEqual({ kind: 'down', since: new Date('2026-08-22T09:00:00Z') });
  });

  it('is only "maybe" when the sighting is older than the shield window', () => {
    // Down at 06:00 does not mean down at noon: a shield can be raised after the sweep.
    const old = sight('2026-08-22T06:00:00Z', '2026-08-22T05:00:00Z');
    expect(shieldStateOf(old, NOW).kind).toBe('maybe');
    const justInside = new Date(NOW.getTime() - SHIELD_MAX_AGE_MS + 1000).toISOString();
    expect(shieldStateOf(sight(justInside, null), NOW)).toEqual({ kind: 'down', since: null });
  });

  it('never shielded and fresh is down with no end time', () => {
    expect(shieldStateOf(sight('2026-08-22T11:30:00Z', null), NOW)).toEqual({
      kind: 'down',
      since: null,
    });
  });
});
