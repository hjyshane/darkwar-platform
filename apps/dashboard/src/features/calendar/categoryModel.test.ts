import { describe, expect, it } from 'vitest';
import { english } from '../../lib/i18n/core';
import {
  DEFAULT_CATEGORIES,
  calendarConfig,
  newCategoryKey,
  parseCalendarCategories,
  parseHiddenEvents,
} from './categoryModel';

describe('parseCalendarCategories', () => {
  it('starts from the six built in, with the old shown-first choice', () => {
    expect(DEFAULT_CATEGORIES.map((c) => [c.key, c.shownAtFirst])).toEqual([
      ['major', true],
      ['recurring', true],
      ['season', true],
      ['event', true],
      ['pass', false],
      ['premium', false],
    ]);
    expect(parseCalendarCategories('junk')).toBe(DEFAULT_CATEGORIES);
  });

  it("keeps the admin's order, names and flags, and an added category", () => {
    const parsed = parseCalendarCategories([
      { key: 'c-guild-war', label: 'Guild war', hidden: false, shownAtFirst: true },
      { key: 'pass', label: 'Passes', hidden: true, shownAtFirst: false },
      { key: 'major', label: null, hidden: false, shownAtFirst: true },
    ]);
    expect(parsed.slice(0, 3).map((c) => [c.key, c.label, c.hidden])).toEqual([
      ['c-guild-war', 'Guild war', false],
      ['pass', 'Passes', true],
      ['major', null, false],
    ]);
  });

  it('puts back a built-in the list left out, so its events never lose their place', () => {
    const parsed = parseCalendarCategories([{ key: 'major', label: null }]);
    expect(parsed.map((c) => c.key)).toEqual([
      'major',
      'recurring',
      'season',
      'event',
      'pass',
      'premium',
    ]);
  });

  it('drops bad keys, duplicates, and an added category with no name', () => {
    const parsed = parseCalendarCategories([
      { key: 'Bad Key', label: 'x' },
      { key: 'major', label: 'First' },
      { key: 'major', label: 'Second' },
      { key: 'c-empty', label: '  ' },
    ]);
    expect(parsed.filter((c) => c.key === 'major').map((c) => c.label)).toEqual(['First']);
    expect(parsed.some((c) => c.key === 'c-empty' || c.key === 'Bad Key')).toBe(false);
  });
});

describe('the calendar config', () => {
  const config = calendarConfig(
    parseCalendarCategories([
      { key: 'c-guild-war', label: 'Guild war', hidden: false, shownAtFirst: true },
      { key: 'premium', label: null, hidden: true, shownAtFirst: true },
    ]),
    ['9001'],
    30,
  );

  it('offers only visible categories, but knows hidden ones', () => {
    expect(config.visibleKeys.has('premium')).toBe(false);
    expect(config.knownKeys.has('premium')).toBe(true);
    expect(config.shownAtFirst).not.toContain('premium');
    expect(config.shownAtFirst).toContain('c-guild-war');
  });

  it("names a category by the admin's label, else the built-in's own", () => {
    expect(config.label('c-guild-war', english)).toBe('Guild war');
    expect(config.label('major', english)).toBe('Major events');
  });

  it('gives built-ins their colour and added ones one of four', () => {
    expect(config.className('major')).toBe('calendar-cat-major');
    expect(config.className('c-guild-war')).toBe('calendar-cat-custom-0');
  });

  it('turns days into the standing threshold, and keeps the hidden events', () => {
    expect(config.standingMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(config.hiddenEvents.has('9001')).toBe(true);
  });
});

describe('keys and ids', () => {
  it('makes a key from a name, unique among those taken', () => {
    expect(newCategoryKey('Guild War', new Set())).toBe('c-guild-war');
    expect(newCategoryKey('Guild War', new Set(['c-guild-war']))).toBe('c-guild-war-2');
    expect(newCategoryKey('길드전', new Set())).toMatch(/^[a-z][a-z0-9_-]*$/);
  });

  it('keeps only digit ids for hidden events, each once', () => {
    expect(parseHiddenEvents(['9001', '9001', 'x', 5, '12'])).toEqual(['9001', '12']);
    expect(parseHiddenEvents('9001')).toEqual([]);
  });
});
