import { describe, expect, it } from 'vitest';
import {
  EVENT_GUIDE_TABS,
  eventGuideHash,
  eventGuideSlugFromHash,
  eventGuideTabFromHash,
  isEventGuideTabOpen,
  routeFromHash,
} from '../src/lib/route';

describe('the Guides tab has an address, and each guide one under it', () => {
  it('lists Guides second, open to a community account', () => {
    expect(EVENT_GUIDE_TABS.map((tab) => tab.id)).toEqual([
      'today',
      'guides',
      'events',
      'survival',
      'duel',
      'scores',
    ]);
    expect(isEventGuideTabOpen('guides', true)).toBe(true);
  });

  it('reads the tab from the bare tab address and from a guide address', () => {
    expect(eventGuideTabFromHash('#/event-guide/guides')).toBe('guides');
    expect(eventGuideTabFromHash('#/event-guide/guides/halloween-2026')).toBe('guides');
  });

  it('reads the slug only under the guides tab', () => {
    expect(eventGuideSlugFromHash('#/event-guide/guides/halloween-2026')).toBe('halloween-2026');
    expect(eventGuideSlugFromHash('#/event-guide/guides')).toBeNull();
    expect(eventGuideSlugFromHash('#/event-guide/duel')).toBeNull();
    expect(eventGuideSlugFromHash('#/event-guide/guides/Not_A_Slug')).toBeNull();
  });

  it('writes the address back', () => {
    expect(eventGuideHash('guides')).toBe('#/event-guide/guides');
    expect(eventGuideHash('guides', 'activity-70005')).toBe('#/event-guide/guides/activity-70005');
    expect(eventGuideHash('duel', 'ignored')).toBe('#/event-guide/duel');
    expect(eventGuideHash('today')).toBe('#/event-guide');
  });

  it('routes a guide address to the event guide, and nothing else with a third segment', () => {
    expect(routeFromHash('#/event-guide/guides/halloween-2026')).toBe('eventGuide');
    expect(routeFromHash('#/event-guide/duel/extra')).not.toBe('eventGuide');
  });
});
