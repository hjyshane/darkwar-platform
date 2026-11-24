import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOWN } from '../../features/calendar/data';
import { DEFAULT_CATEGORY_BY_TYPE, packCategory } from '../../features/shopValue/data';
import { ADMIN_SECTIONS } from '../adminAccess';
import { canUndo, describeItem, shortValue } from './history';
import {
  CALENDAR_DEFAULT_SHOWN,
  PACK_CATEGORY_BY_TYPE,
  SITE_SETTINGS,
  isDefault,
  numberSetting,
  stableJson,
} from './registry';
import { searchSettings } from './search';

describe('the settings registry', () => {
  it('gives every entry a key of its own, under the site. prefix', () => {
    const keys = SITE_SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^site\.[a-z_]+$/);
  });

  it('starts every entry at the constant it replaced', () => {
    expect(PACK_CATEGORY_BY_TYPE.defaultValue).toBe(DEFAULT_CATEGORY_BY_TYPE);
    expect(new Set(CALENDAR_DEFAULT_SHOWN.defaultValue)).toEqual(DEFAULT_SHOWN);
    for (const setting of SITE_SETTINGS) {
      // The default must survive its own parser, or the form would show a
      // value nobody can save back.
      expect(stableJson(setting.parse(setting.defaultValue))).toBe(
        stableJson(setting.defaultValue),
      );
    }
  });

  it('reads anything unreadable as the default, so a broken value cannot take a screen down', () => {
    for (const setting of SITE_SETTINGS) {
      for (const junk of [null, 'x', 42, true, [1, 2]]) {
        const parsed = setting.parse(junk);
        // Either the default, or (for a choice list given an array) a valid empty pick.
        expect(
          stableJson(parsed) === stableJson(setting.defaultValue) || stableJson(parsed) === '[]',
        ).toBe(true);
      }
    }
  });

  it('keeps the valid part of a pack-category table and drops the rest', () => {
    expect(
      PACK_CATEGORY_BY_TYPE.parse({ '26': 'daily', '77': 'pass', x: 'daily', '9': 'nope' }),
    ).toEqual({ '26': 'daily', '77': 'pass' });
    // Other is what an unlisted type already is; it is not offered as a target.
    expect(PACK_CATEGORY_BY_TYPE.parse({ '26': 'other' })).toEqual({});
  });

  it('files a pack by the stored table when there is one', () => {
    const stored = PACK_CATEGORY_BY_TYPE.parse({ '9999': 'hero' });
    expect(packCategory('9999', stored).key).toBe('hero');
    expect(packCategory('9999').key).toBe('other');
    // A type the stored table leaves out is Other, not the old default's answer.
    expect(packCategory('26', stored).key).toBe('other');
  });

  it('keeps a choice list in the options order and drops unknown choices', () => {
    expect(CALENDAR_DEFAULT_SHOWN.parse(['premium', 'major', 'nonsense', 'major'])).toEqual([
      'major',
      'premium',
    ]);
  });

  it('compares maps by content, not key order', () => {
    expect(isDefault(PACK_CATEGORY_BY_TYPE, { ...DEFAULT_CATEGORY_BY_TYPE })).toBe(true);
    const reversed = Object.fromEntries(Object.entries(DEFAULT_CATEGORY_BY_TYPE).reverse());
    expect(isDefault(PACK_CATEGORY_BY_TYPE, reversed)).toBe(true);
    expect(isDefault(PACK_CATEGORY_BY_TYPE, { '26': 'daily' })).toBe(false);
  });

  it('bounds a number setting', () => {
    const rate = numberSetting({
      key: 'site.test_rate',
      label: 'Test',
      help: 'Test.',
      usedOn: { label: 'Nowhere', href: '#/' },
      defaultValue: 5,
      min: 1,
      max: 10,
      step: 1,
    });
    expect(rate.parse(7)).toBe(7);
    expect(rate.parse(11)).toBe(5);
    expect(rate.parse(Number.NaN)).toBe(5);
    expect(rate.parse('7')).toBe(5);
  });
});

describe('searchSettings', () => {
  it('finds a registry value by words from its label or help, and sends it to Site values', () => {
    const hits = searchSettings('pack categ', ADMIN_SECTIONS, SITE_SETTINGS);
    expect(hits.map((hit) => [hit.label, hit.href, hit.where])).toContainEqual([
      'Pack categories',
      '#/admin/catalogue/site-values',
      'Shared › Site values',
    ]);
  });

  it('finds sections by name in any group', () => {
    expect(
      searchSettings('history', ADMIN_SECTIONS, SITE_SETTINGS).map((hit) => hit.href),
    ).toContain('#/admin/operations/settings-history');
  });

  it('offers no registry value to somebody who cannot open Site values', () => {
    const withoutSiteValues = ADMIN_SECTIONS.filter(
      (section) => section.id !== 'site-values-heading',
    );
    expect(searchSettings('pack categories', withoutSiteValues, SITE_SETTINGS)).toEqual([]);
  });

  it('finds nothing for an empty query', () => {
    expect(searchSettings('   ', ADMIN_SECTIONS, SITE_SETTINGS)).toEqual([]);
  });
});

describe('the change history', () => {
  it('names a registry key by its label, and other rows by their parts', () => {
    expect(describeItem({ source: 'app_settings', item: 'site.pack_category_by_type' })).toBe(
      'Pack categories',
    );
    expect(describeItem({ source: 'tab_visibility', item: 'calendar:member' })).toBe(
      'calendar · member',
    );
    expect(describeItem({ source: 'servers', item: '589' })).toBe('Server 589');
  });

  it('offers undo only for site-wide settings, and never for the alliance pin', () => {
    expect(canUndo({ source: 'app_settings', item: 'site.calendar_default_shown' })).toBe(true);
    expect(canUndo({ source: 'app_settings', item: 'own_alliance' })).toBe(false);
    expect(canUndo({ source: 'alliance_settings', item: 'rank_tiers' })).toBe(false);
    expect(canUndo({ source: 'role_permissions', item: 'member:members.view' })).toBe(false);
  });

  it('shortens a long value for one cell', () => {
    expect(shortValue(null)).toBe('—');
    expect(shortValue({ a: 1 })).toBe('{"a":1}');
    expect(shortValue('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
