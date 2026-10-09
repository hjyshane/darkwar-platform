import { describe, expect, it } from 'vitest';
import {
  EVENT_GUIDE_TABS,
  eventGuideHash,
  eventGuideTabFromHash,
  routeFromHash,
} from '../src/lib/route';

describe('event guide addresses', () => {
  it('keeps the old address, and it is the first tab', () => {
    expect(routeFromHash('#/event-guide')).toBe('eventGuide');
    expect(eventGuideTabFromHash('#/event-guide')).toBe('today');
  });

  it('gives every tab an address that comes back as the same tab', () => {
    for (const tab of EVENT_GUIDE_TABS) {
      const hash = eventGuideHash(tab.id);
      expect(routeFromHash(hash)).toBe('eventGuide');
      expect(eventGuideTabFromHash(hash)).toBe(tab.id);
    }
  });

  it('writes the first tab as the bare address, so an existing link and the sidebar agree', () => {
    expect(eventGuideHash('today')).toBe('#/event-guide');
    expect(eventGuideHash('events')).toBe('#/event-guide/events');
    expect(eventGuideHash('duel')).toBe('#/event-guide/duel');
  });

  it('does not take an unknown tab for the guide', () => {
    expect(routeFromHash('#/event-guide/nope')).toBe('overview');
  });
});
