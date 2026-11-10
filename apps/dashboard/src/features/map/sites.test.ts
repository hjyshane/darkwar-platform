import { describe, expect, it } from 'vitest';
import {
  SITE_UNLIT,
  type TreasureSite,
  closesAt,
  isUnlit,
  shareLabel,
  siteFromRow,
  siteIsStanding,
  siteTitle,
} from './sites';

const NOW = new Date('2026-11-10T01:10:26Z');

function site(overrides: Partial<TreasureSite> = {}): TreasureSite {
  return {
    siteUuid: '1435887707426538645',
    serverId: 580,
    at: { x: 454, y: 276 },
    gameAt: { x: 453, y: 275 },
    status: SITE_UNLIT,
    expiresAt: new Date('2026-11-10T02:25:00Z'),
    revealedAt: null,
    limitSeconds: null,
    participants: 0,
    ...overrides,
  };
}

describe('share label', () => {
  it('is the form the game itself shows, so it pastes back in', () => {
    expect(shareLabel(site())).toBe('#580[X:453 Y:275]');
  });
});

describe('closing time', () => {
  it('is the expiry while the lantern is unlit', () => {
    expect(closesAt(site())).toEqual(new Date('2026-11-10T02:25:00Z'));
  });

  it('is the hour from the reveal once the site is open', () => {
    const open = site({
      status: 2,
      revealedAt: new Date('2026-11-10T00:41:14Z'),
      limitSeconds: 3600,
    });
    expect(closesAt(open)).toEqual(new Date('2026-11-10T01:41:14Z'));
    expect(siteIsStanding(open, NOW)).toBe(true);
    expect(siteIsStanding(open, new Date('2026-11-10T01:45:00Z'))).toBe(false);
  });

  it('never outlives the expiry, even with an hour left on the reveal', () => {
    const late = site({
      status: 2,
      revealedAt: new Date('2026-11-10T02:00:00Z'),
      limitSeconds: 3600,
    });
    expect(closesAt(late)).toEqual(new Date('2026-11-10T02:25:00Z'));
  });
});

describe('titles', () => {
  it('say whether to go light it or go explore it', () => {
    expect(siteTitle(site())).toBe('Large Treasure Spot · #580[X:453 Y:275] · unlit lantern');
    expect(siteTitle(site({ status: 2, participants: 3 }))).toBe(
      'Large Treasure Spot · #580[X:453 Y:275] · open · 3 exploring',
    );
    expect(siteTitle(site({ status: 0 }))).toContain('being lit');
    expect(isUnlit(site({ status: 1 }))).toBe(false);
  });
});

describe('rows', () => {
  const row = {
    site_uuid: '1435887707426538645',
    server_id: 580,
    x: 454,
    y: 276,
    game_x: 453,
    game_y: 275,
    status: 3,
    expires_at: '2026-11-10T02:25:00+00:00',
    revealed_at: null,
    limit_seconds: null,
    participant_count: 0,
  };

  it('become sites, with the tile and the game coordinate kept apart', () => {
    const got = siteFromRow(row);
    expect(got?.at).toEqual({ x: 454, y: 276 });
    expect(got?.gameAt).toEqual({ x: 453, y: 275 });
    expect(got?.expiresAt.toISOString()).toBe('2026-11-10T02:25:00.000Z');
  });

  it('are dropped rather than guessed at when a coordinate is missing', () => {
    expect(siteFromRow({ ...row, game_x: null })).toBeNull();
    expect(siteFromRow({ ...row, expires_at: null })).toBeNull();
  });
});
