import { describe, expect, it } from 'vitest';
import {
  EVENT_GUIDE_TABS,
  eventGuideHash,
  eventGuideTabFromHash,
  routeFromHash,
} from '../src/lib/route';

describe('the event guide tabs', () => {
  it('lists the four tabs in order', () => {
    expect(EVENT_GUIDE_TABS.map((tab) => tab.id)).toEqual(['today', 'events', 'survival', 'duel']);
  });

  it('no longer has a Guides or Duel scores tab: their addresses are not routes', () => {
    expect(routeFromHash('#/event-guide/guides')).not.toBe('eventGuide');
    expect(routeFromHash('#/event-guide/guides/halloween-2026')).not.toBe('eventGuide');
    expect(routeFromHash('#/event-guide/scores')).not.toBe('eventGuide');
  });

  it('writes the address back', () => {
    expect(eventGuideHash('duel')).toBe('#/event-guide/duel');
    expect(eventGuideHash('today')).toBe('#/event-guide');
    expect(eventGuideTabFromHash(eventGuideHash('survival'))).toBe('survival');
  });

  it('routes a tab address to the event guide, and nothing with a third segment', () => {
    expect(routeFromHash('#/event-guide/duel')).toBe('eventGuide');
    expect(routeFromHash('#/event-guide/duel/extra')).not.toBe('eventGuide');
  });
});
