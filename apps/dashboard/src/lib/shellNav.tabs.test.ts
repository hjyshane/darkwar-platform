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

  test("the alliance page's views sit under Overview", () => {
    expect(childLabels(withOwn, 'Overview')).toEqual([
      'Members',
      'Ranking',
      'Power and towers',
      'Activity',
      'Against the server',
    ]);
    const views = item(withOwn, 'Overview')?.children ?? [];
    expect(views[2]?.href).toBe(`#/alliance/${OWN.alliance_id}/power`);
  });

  test('Overview stays current on our own alliance page, with the view marked', () => {
    const onPower: NavContext = {
      ...withOwn,
      route: 'alliance',
      allianceId: OWN.alliance_id,
      tabs: { alliance: 'power' },
    };
    const overview = item(onPower, 'Overview');
    expect(overview?.current).toBe(true);
    expect(overview?.children?.find((c) => c.current)?.label).toBe('Power and towers');
    // Somebody else's alliance page is not ours.
    const other = item({ ...onPower, allianceId: 'not-ours' }, 'Overview');
    expect(other?.current).toBe(false);
  });

  test('Members, Hive and Events are under the alliance entry, not beside it', () => {
    expect(labels(withOwn)).toContain('CBFW');
    expect(labels(withOwn)).not.toContain('Members');
    expect(labels(withOwn)).not.toContain('Hive');
    expect(labels(withOwn)).not.toContain('Events');
    expect(childLabels(withOwn, 'CBFW')).toEqual(['Members', 'Hive', 'Events']);
    expect(item(withOwn, 'CBFW')?.href).toBe('#/members');
    // The tools stay beside it.
    expect(labels(withOwn)).toContain('Planner');
  });

  test('the entry opens the first screen the reader may see', () => {
    const noRoster = { ...withOwn, mayViewMembers: false };
    expect(childLabels(noRoster, 'CBFW')).toEqual(['Hive', 'Events']);
    expect(item(noRoster, 'CBFW')?.href).toBe('#/hive');
    // Not before the grid has answered, either.
    expect(childLabels({ ...withOwn, mayViewMembers: undefined }, 'CBFW')).not.toContain('Members');
  });

  test('the entry is drawn before the alliance is known, under a plain name', () => {
    expect(childLabels(base, 'Our alliance')).toEqual(['Members', 'Hive', 'Events']);
    // ... but the alliance page's views wait for it.
    expect(item(base, 'Overview')?.children).toBeUndefined();
  });

  test('the entry is current on any screen under it', () => {
    for (const route of ['members', 'hive', 'events', 'blackMoney', 'season'] as const) {
      expect(item({ ...withOwn, route }, 'CBFW')?.current).toBe(true);
    }
    expect(item({ ...withOwn, route: 'planner' }, 'CBFW')?.current).toBe(false);
  });

  test('an admin can still hide each screen (0295)', () => {
    const noHive = { ...withOwn, tabShown: (tab: string) => tab !== 'hive' };
    expect(childLabels(noHive, 'CBFW')).toEqual(['Members', 'Events']);
    // Hiding every screen removes the entry rather than leaving it empty.
    const none = {
      ...withOwn,
      tabShown: (tab: string) => !['members', 'hive', 'events'].includes(tab),
    };
    expect(labels(none)).not.toContain('CBFW');
    // "Our alliance" hides the page's views under Overview.
    const noPage = { ...withOwn, tabShown: (tab: string) => tab !== 'alliance' };
    expect(item(noPage, 'Overview')?.children).toBeUndefined();
    expect(childLabels(noPage, 'CBFW')).toEqual(['Members', 'Hive', 'Events']);
  });

  test('a community account gets neither the entry nor the views', () => {
    const community = { ...withOwn, isCommunity: true };
    expect(labels(community)).not.toContain('CBFW');
    expect(item(community, 'Overview')?.children).toBeUndefined();
    expect(labels(community)).toContain('Planner');
  });

  test('the top bar names the filed screen', () => {
    const onHive: NavContext = { ...withOwn, route: 'hive' };
    expect(breadcrumb(buildNav(onHive), [], 'hive')).toEqual(['Alliance', 'CBFW', 'Hive']);
    const onPage: NavContext = { ...withOwn, route: 'alliance', allianceId: OWN.alliance_id };
    expect(breadcrumb(buildNav(onPage), [], 'alliance')).toEqual(['Watch', 'Overview', 'Members']);
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
    expect(found).toContain('Overview › Power and towers');
    // Not a planner: the hive has no tabs to find.
    const reader = paletteEntries(buildNav(withOwn).flatMap((g) => g.items)).map((e) => e.label);
    expect(reader).not.toContain('CBFW › Hive › Draw the shape');
    expect(reader).not.toContain('CBFW › Events › Season 2');
  });
});
