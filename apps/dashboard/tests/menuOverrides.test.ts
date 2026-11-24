// The sidebar as an admin arranged it (owner, 2026-11-24): rename, reorder and
// hide any entry or screen under one, never move it to another group.
import { describe, expect, it } from 'vitest';
import { childScope, itemScope, menuKey, storedMenuRefs } from '../src/lib/menuOverrides';
import { type NavContext, buildNav } from '../src/lib/shellNav';
import { type Overrides, overrideKey } from '../src/lib/uiOverrides';

const stored = (rows: Array<[string, string, 'label' | 'order' | 'hidden', string]>): Overrides =>
  new Map(rows.map(([scope, key, kind, value]) => [overrideKey(scope, key, kind), value]));

const ctx = (overrides: Overrides, over: Partial<NavContext> = {}): NavContext => ({
  route: 'home',
  allianceId: null,
  own: { alliance_id: 'a1', label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: false,
  seasonNames: {},
  overrides,
  ...over,
});

const top = (c: NavContext) => buildNav(c).flatMap((g) => g.items.map((i) => i.label));
const under = (c: NavContext, label: string) =>
  buildNav(c)
    .flatMap((g) => g.items)
    .find((i) => i.label === label);

describe('the admin arranging the menu', () => {
  it('renames, reorders and hides entries for everybody', () => {
    const o = stored([
      ['menu-watch', 'map', 'order', '0'],
      ['menu-watch', 'home', 'label', 'Start'],
      ['menu-watch', 'calculator', 'hidden', 'true'],
    ]);
    expect(top(ctx(o))).toEqual(['Map', 'Start', 'CBFW', 'Guides']);
  });

  it('keeps a hidden entry, marked, for an admin in edit mode', () => {
    const o = stored([['menu-watch', 'calculator', 'hidden', 'true']]);
    const items = buildNav(ctx(o, { isAdmin: true, showHiddenMenu: true }))[0]?.items ?? [];
    expect(items.find((i) => i.key === '#/calculator')?.hidden).toBe(true);
    expect(items.find((i) => i.key === '#/map')?.hidden).toBeUndefined();
  });

  it('reorders the screens under an entry and opens the first one still shown', () => {
    const scope = childScope('own-alliance');
    const o = stored([
      [scope, 'hive', 'order', '0'],
      [scope, 'own-page', 'hidden', 'true'],
    ]);
    const alliance = under(ctx(o), 'CBFW');
    expect(alliance?.children?.slice(0, 2).map((c) => c.label)).toEqual(['Hive', 'Black Gold']);
    expect(alliance?.href).toBe('#/hive');
  });

  it('leaves the event screens to the strip above them, and a screen’s own tabs alone', () => {
    const alliance = under(ctx(stored([])), 'CBFW');
    const blackGold = alliance?.children?.find((c) => c.key === '#/black-gold');
    expect(blackGold?.edit).toBeUndefined();
    expect(alliance?.children?.find((c) => c.key === '#/hive')?.edit).toBeDefined();
    const tools = under(ctx(stored([])), 'Tools');
    // The calculator's pages are the page's own tabs; the planner is a screen.
    expect(tools?.children?.filter((c) => c.edit !== undefined).map((c) => c.label)).toEqual([
      'Planner',
    ]);
  });

  it('drops an entry whose screens are all hidden', () => {
    const scope = childScope('guides-entry');
    const o = stored([
      [scope, 'notices', 'hidden', 'true'],
      [scope, 'guides', 'hidden', 'true'],
      [scope, 'event-guide', 'hidden', 'true'],
    ]);
    expect(top(ctx(o))).not.toContain('Guides');
  });

  it('renames a group’s caption', () => {
    const o = stored([['menu-groups', 'watch', 'label', 'Alliance']]);
    expect(buildNav(ctx(o)).map((g) => g.label)).toEqual(['Alliance']);
  });

  it('lists only what an admin changed, for the reset', () => {
    const o = stored([
      ['menu-watch', 'map', 'order', '0'],
      [childScope('own-alliance'), 'hive', 'hidden', 'true'],
    ]);
    const groups = buildNav(ctx(o, { isAdmin: true, showHiddenMenu: true }));
    expect(storedMenuRefs(groups, o).map((ref) => `${ref.scope}/${ref.key}`)).toEqual([
      'menu-watch/map',
      'menu-in-own-alliance/hive',
    ]);
  });
});

describe('the keys it stores under', () => {
  it('fits the table’s checks (0279)', () => {
    for (const scope of [itemScope('watch'), childScope('own-alliance'), childScope('#/x/y')]) {
      expect(scope).toMatch(/^[a-z][a-z0-9_-]{0,39}$/);
    }
    for (const key of ['#/', '#/calculator', '#/members/running', 'own-page']) {
      expect(menuKey(key)).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/);
    }
  });
});
