import { describe, expect, it } from 'vitest';
import { communityMayOpen, isCommunityRole } from './communityAccess';
import { isEventGuideTabOpen } from './route';

describe('community role (0282)', () => {
  it('opens the eight game-wide pages', () => {
    for (const route of [
      'overview',
      'rankings',
      'crossRankings',
      'migration',
      'map',
      'planner',
      'calendar',
      'eventGuide',
      'shopValue',
    ] as const) {
      expect(communityMayOpen(route)).toBe(true);
    }
  });

  it('keeps the alliance and its people closed', () => {
    for (const route of [
      'members',
      'hive',
      'season',
      'blackMoney',
      'participation',
      'frankie',
      'giftCodes',
      'notices',
      'guides',
      'player',
      'alliance',
      'server',
      'admin',
      'schedule',
    ] as const) {
      expect(communityMayOpen(route)).toBe(false);
    }
  });

  it('is only the community role', () => {
    expect(isCommunityRole('community')).toBe(true);
    expect(isCommunityRole('member')).toBe(false);
    expect(isCommunityRole(undefined)).toBe(false);
  });

  it('drops the duel scores and our times from the event guide, and nothing else', () => {
    expect(isEventGuideTabOpen('scores', true)).toBe(false);
    expect(isEventGuideTabOpen('events', true)).toBe(false);
    expect(isEventGuideTabOpen('duel', true)).toBe(true);
    expect(isEventGuideTabOpen('today', true)).toBe(true);
    expect(isEventGuideTabOpen('survival', true)).toBe(true);
    expect(isEventGuideTabOpen('scores', false)).toBe(true);
  });
});
