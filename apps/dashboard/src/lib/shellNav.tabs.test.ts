import { describe, expect, test } from 'vitest';
import { type NavContext, type NavItem, breadcrumb, buildNav, paletteEntries } from './shellNav';

const base: NavContext = {
  route: 'overview',
  allianceId: null,
  own: null,
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: true,
  seasonNames: {},
};

const OWN = { alliance_id: '22222222-2222-4222-8222-222222222201', label: 'CBFW' };

const labels = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));
const item = (ctx: NavContext, label: string): NavItem | undefined =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === label);
const childLabels = (ctx: NavContext, label: string) =>
  (item(ctx, label)?.children ?? []).map((c) => c.label);

describe('buildNav tab visibility (0295)', () => {
  test('without rules every tab the role is entitled to is drawn', () => {
    expect(labels(base)).toContain('Migration');
    expect(labels(base)).toContain('Map');
    expect(labels(base)).toContain('Notices');
  });

  test('a hidden tab leaves the sidebar, the rest stay', () => {
    const shown = labels({ ...base, tabShown: (tab) => tab !== 'migration' && tab !== 'notices' });
    expect(shown).not.toContain('Migration');
    expect(shown).not.toContain('Notices');
    expect(shown).toContain('Rankings');
    expect(shown).toContain('Guides');
  });

  test('a rule never shows what the role gate withholds', () => {
    const member = { ...base, isOfficer: false, tabShown: () => true };
    expect(labels(member)).not.toContain('Migration');
  });
});

describe('buildNav hierarchy (2026-11-08)', () => {
  const withOwn: NavContext = { ...base, own: OWN };

  const ownPage = (ctx: NavContext) =>
    item(ctx, 'CBFW')?.children?.find((c) => c.label === 'Overview');

  test("the alliance page is the entry's Overview, its views kept as tabs", () => {
    expect(childLabels(withOwn, 'CBFW')).toEqual(['Overview', 'Members', 'Hive', 'Events']);
    expect(item(withOwn, 'CBFW')?.href).toBe(`#/alliance/${OWN.alliance_id}`);
    expect(ownPage(withOwn)?.href).toBe(`#/alliance/${OWN.alliance_id}`);
    // Every view but past names (whether there are any is a fact about the
    // data), in the page's order: the page's own Overview tab among them.
    expect(ownPage(withOwn)?.tabs?.map((t) => t.label)).toEqual([
      'Members',
      'Overview',
      'Moves',
      'Ranking',
      'Power and towers',
      'Activity',
      'Against the server',
    ]);
    expect(ownPage(withOwn)?.tabs?.find((t) => t.label === 'Power and towers')?.href).toBe(
      `#/alliance/${OWN.alliance_id}/power`,
    );
    // The top Overview is the landing screen and nothing more.
    expect(item(withOwn, 'Overview')?.children).toBeUndefined();
  });

  test('the entry and its Overview are current on our own alliance page, with the view marked', () => {
    const onPower: NavContext = {
      ...withOwn,
      route: 'alliance',
      allianceId: OWN.alliance_id,
      tabs: { alliance: 'power' },
    };
    expect(item(onPower, 'CBFW')?.current).toBe(true);
    expect(ownPage(onPower)?.current).toBe(true);
    expect(ownPage(onPower)?.tabs?.find((t) => t.current)?.label).toBe('Power and towers');
    expect(item(onPower, 'Overview')?.current).toBe(false);
    // Somebody else's alliance page is not ours.
    const other = { ...onPower, allianceId: 'not-ours' };
    expect(item(other, 'CBFW')?.current).toBe(false);
    expect(ownPage(other)?.current).toBe(false);
  });

  test('Members, Hive and Events are under the alliance entry, not beside it', () => {
    expect(labels(withOwn)).toContain('CBFW');
    expect(labels(withOwn)).not.toContain('Members');
    expect(labels(withOwn)).not.toContain('Hive');
    expect(labels(withOwn)).not.toContain('Events');
    // The tools stay beside it; the planner is archived (2026-11-12).
    expect(labels(withOwn)).toContain('Calculator');
    expect(labels(withOwn)).not.toContain('Planner');
  });

  test('the entry opens the first screen the reader may see', () => {
    const noRoster = { ...withOwn, mayViewMembers: false };
    expect(childLabels(noRoster, 'CBFW')).toEqual(['Overview', 'Hive', 'Events']);
    // Not before the grid has answered, either.
    expect(childLabels({ ...withOwn, mayViewMembers: undefined }, 'CBFW')).not.toContain('Members');
    // Without the page (hidden), the first of the rest.
    const noPage = { ...noRoster, tabShown: (tab: string) => tab !== 'alliance' };
    expect(item(noPage, 'CBFW')?.href).toBe('#/hive');
  });

  test('the entry is drawn before the alliance is known, under a plain name', () => {
    // The page's address is the uuid, so it waits; the rest do not.
    expect(childLabels(base, 'Our alliance')).toEqual(['Members', 'Hive', 'Events']);
    expect(item(base, 'Our alliance')?.href).toBe('#/members');
  });

  test('the entry is current on any screen under it', () => {
    for (const route of ['members', 'hive', 'events', 'blackMoney', 'season'] as const) {
      expect(item({ ...withOwn, route }, 'CBFW')?.current).toBe(true);
    }
    expect(item({ ...withOwn, route: 'planner' }, 'CBFW')?.current).toBe(false);
    expect(item({ ...withOwn, route: 'overview' }, 'CBFW')?.current).toBe(false);
  });

  test('an admin can still hide each screen (0295)', () => {
    const noHive = { ...withOwn, tabShown: (tab: string) => tab !== 'hive' };
    expect(childLabels(noHive, 'CBFW')).toEqual(['Overview', 'Members', 'Events']);
    // "Our alliance" hides the page.
    const noPage = { ...withOwn, tabShown: (tab: string) => tab !== 'alliance' };
    expect(childLabels(noPage, 'CBFW')).toEqual(['Members', 'Hive', 'Events']);
    // Hiding every screen removes the entry rather than leaving it empty.
    const none = {
      ...withOwn,
      tabShown: (tab: string) => !['alliance', 'members', 'hive', 'events'].includes(tab),
    };
    expect(labels(none)).not.toContain('CBFW');
  });

  test('a community account gets neither the entry nor the page', () => {
    const community = { ...withOwn, isCommunity: true };
    expect(labels(community)).not.toContain('CBFW');
    expect(labels(community)).toContain('Calculator');
  });

  test('the top bar names the filed screen', () => {
    const onHive: NavContext = { ...withOwn, route: 'hive' };
    expect(breadcrumb(buildNav(onHive), [], 'hive')).toEqual(['Alliance', 'CBFW', 'Hive']);
    const onPage: NavContext = { ...withOwn, route: 'alliance', allianceId: OWN.alliance_id };
    expect(breadcrumb(buildNav(onPage), [], 'alliance')).toEqual(['Alliance', 'CBFW', 'Overview']);
    // An entry's own tabs are not named: the page shows them.
    const onDuel: NavContext = { ...withOwn, route: 'eventGuide', eventGuideTab: 'duel' };
    expect(breadcrumb(buildNav(onDuel), [], 'eventGuide')).toEqual(['Events', 'Event guide']);
  });

  test('Ctrl+K still finds the screens behind Events and the hive steps', () => {
    const planner = { ...withOwn, isAdmin: true, mayPlanHive: true };
    const found = paletteEntries(buildNav(planner).flatMap((g) => g.items)).map((e) => e.label);
    expect(found).toContain('CBFW › Events › Black Gold');
    expect(found).toContain('CBFW › Events › Season 2');
    expect(found).toContain('CBFW › Hive › Draw the shape');
    expect(found).toContain('CBFW › Members › This ranking · weekly');
    expect(found).toContain('CBFW › Overview › Power and towers');
    // Not a planner: the hive has no tabs to find.
    const reader = paletteEntries(buildNav(withOwn).flatMap((g) => g.items)).map((e) => e.label);
    expect(reader).not.toContain('CBFW › Hive › Draw the shape');
    expect(reader).not.toContain('CBFW › Events › Season 2');
  });
});
