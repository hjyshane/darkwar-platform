import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_VIEWS,
  HIVE,
  MEMBERS,
  PLANNER,
  allianceHash,
  allianceIdFromHash,
  allianceViewFromHash,
  plannerKindFromHash,
  routeFromHash,
} from '../src/lib/route';
import { type NavContext, type NavItem, buildNav } from '../src/lib/shellNav';

const UUID = '22222222-2222-4222-8222-222222222201';

describe('tab addresses', () => {
  it('keeps every bare address on its screen, and on its first tab', () => {
    expect(routeFromHash('#/members')).toBe('members');
    expect(MEMBERS.fromHash('#/members')).toBe('settled');
    expect(routeFromHash('#/hive')).toBe('hive');
    expect(HIVE.fromHash('#/hive')).toBe('plan');
    expect(routeFromHash('#/planner')).toBe('planner');
    expect(PLANNER.fromHash('#/planner')).toBe('raise');
  });

  it('gives each tab an address that comes back as the same screen and tab', () => {
    for (const tab of MEMBERS.tabs) {
      expect(routeFromHash(MEMBERS.hash(tab.id))).toBe('members');
      expect(MEMBERS.fromHash(MEMBERS.hash(tab.id))).toBe(tab.id);
    }
    for (const tab of HIVE.tabs) {
      expect(routeFromHash(HIVE.hash(tab.id))).toBe('hive');
      expect(HIVE.fromHash(HIVE.hash(tab.id))).toBe(tab.id);
    }
    for (const tab of PLANNER.tabs) {
      expect(routeFromHash(PLANNER.hash(tab.id))).toBe('planner');
      expect(PLANNER.fromHash(PLANNER.hash(tab.id))).toBe(tab.id);
    }
  });

  it('writes the first tab as the bare address', () => {
    expect(MEMBERS.hash('settled')).toBe('#/members');
    expect(MEMBERS.hash('running')).toBe('#/members/running');
    expect(HIVE.hash('plan')).toBe('#/hive');
  });

  it('does not take an unknown tab for the screen', () => {
    expect(routeFromHash('#/hive/nope')).toBe('overview');
    expect(routeFromHash('#/planner/nope')).toBe('overview');
  });

  it('puts an alliance view after its id, and still finds the id', () => {
    for (const view of ALLIANCE_VIEWS) {
      const hash = allianceHash(UUID, view.id);
      expect(routeFromHash(hash)).toBe('alliance');
      expect(allianceIdFromHash(hash)).toBe(UUID);
      expect(allianceViewFromHash(hash)).toBe(view.id);
    }
    // Only the address with no view is bare: Members is written out like the
    // rest. The bare one names no view, and the page opens on its own first.
    expect(allianceHash(UUID)).toBe(`#/alliance/${UUID}`);
    expect(allianceHash(UUID, 'members')).toBe(`#/alliance/${UUID}/members`);
    expect(allianceHash(UUID, 'overview')).toBe(`#/alliance/${UUID}/overview`);
    expect(allianceViewFromHash(`#/alliance/${UUID}`)).toBeNull();
    expect(allianceViewFromHash('#/members')).toBeNull();
  });

  it('lists the alliance views in the order the page draws them', () => {
    expect(ALLIANCE_VIEWS.map((view) => [view.id, view.label])).toEqual([
      ['overview', 'Overview'],
      ['members', 'Members'],
      ['moves', 'Moves'],
      ['board', 'Ranking'],
      ['activity', 'Activity'],
      ['compare', 'Against the server'],
      ['names', 'Also known as'],
    ]);
  });

  it('sends the retired Power and towers address to Activity, which took it over', () => {
    const hash = `#/alliance/${UUID}/power`;
    expect(ALLIANCE_VIEWS.map((view) => view.id as string)).not.toContain('power');
    expect(routeFromHash(hash)).toBe('alliance');
    expect(allianceIdFromHash(hash)).toBe(UUID);
    expect(allianceViewFromHash(hash)).toBe('activity');
    // An address nobody ever handed out is still not the alliance page.
    expect(routeFromHash(`#/alliance/${UUID}/nope`)).toBe('overview');
    expect(allianceViewFromHash(`#/alliance/${UUID}/nope`)).toBeNull();
  });
});

const base = (over: Partial<NavContext> = {}): NavContext => ({
  route: 'overview',
  allianceId: null,
  own: { alliance_id: UUID, label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  // An officer: the member menu, plus Alarms under the alliance (2026-11-19).
  isOfficer: true,
  seasonNames: {},
  ...over,
});

/** An admin: the same menu, and the Admin menu under it. */
const admin = (over: Partial<NavContext> = {}): NavContext => base({ isAdmin: true, ...over });

const entry = (ctx: NavContext, group: string, label: string): NavItem | undefined =>
  buildNav(ctx)
    .find((candidate) => candidate.id === group)
    ?.items.find((candidate) => candidate.label === label);

/** A screen filed under an entry: its own tabs are not drawn in the sidebar,
 * but are kept on the child for Ctrl+K. */
const filed = (ctx: NavContext, group: string, under: string, label: string) =>
  entry(ctx, group, under)?.children?.find((child) => child.label === label);

/** Our alliance's page, the first screen under its entry (2026-11-08). */
const ownPage = (ctx: NavContext) => filed(ctx, 'watch', 'CBFW', 'Overview');

describe('sidebar tabs for the alliance screens', () => {
  it('keeps the two ranking tabs on Members, in the Roster of the admin, marking the open one', () => {
    const ctx = admin({ route: 'members', tabs: { members: 'running' } });
    const members = filed(ctx, 'admin', 'Roster', 'Members');

    expect(members).toMatchObject({ href: '#/members', screen: true, current: true });
    expect(members?.tabs?.map((tab) => [tab.label, tab.href, tab.current])).toEqual([
      ['Last ranking', '#/members', false],
      ['This ranking · weekly', '#/members/running', true],
    ]);
    // The bare address is the first tab.
    expect(
      filed(admin({ route: 'members' }), 'admin', 'Roster', 'Members')
        ?.tabs?.filter((tab) => tab.current)
        .map((tab) => tab.label),
    ).toEqual(['Last ranking']);
    // Members is no longer under our alliance's entry, for anybody.
    expect(filed(ctx, 'watch', 'CBFW', 'Members')).toBeUndefined();
    expect(filed(base({ route: 'members' }), 'watch', 'CBFW', 'Members')).toBeUndefined();
  });

  it('lists the hive steps under Hive for a planner only', () => {
    const hive = (mayPlanHive: boolean | undefined, tab?: 'people') =>
      entry(base({ route: 'hive', mayPlanHive, tabs: { hive: tab } }), 'watch', 'Hive');

    expect(hive(true, 'people')?.children?.map((c) => [c.label, c.href, c.current])).toEqual([
      ['Plan', '#/hive', false],
      ['Draw the shape', '#/hive/shape', false],
      ['Who goes where', '#/hive/people', true],
    ]);
    // The bare address is the plan.
    expect(
      hive(true)
        ?.children?.filter((c) => c.current)
        .map((c) => c.label),
    ).toEqual(['Plan']);
    // Everybody else sees the plan and nothing else: the entry, with no steps.
    expect(hive(false)).toMatchObject({ href: '#/hive', current: true });
    expect(hive(false)?.children).toBeUndefined();
    expect(hive(undefined)).toMatchObject({ href: '#/hive', current: true });
    expect(hive(undefined)?.children).toBeUndefined();
    // Hive is an entry of its own, not a screen under our alliance's.
    const planner = base({ route: 'hive', mayPlanHive: true });
    expect(filed(planner, 'watch', 'CBFW', 'Hive')).toBeUndefined();
  });

  it('gives the archived planner no sidebar entry, while its address still opens it', () => {
    for (const ctx of [base({ route: 'planner' }), admin({ route: 'planner' })]) {
      const named = buildNav(ctx).flatMap((group) =>
        group.items.flatMap((item) => [item, ...(item.children ?? [])]),
      );
      expect(named.length).toBeGreaterThan(6);
      expect(
        named.filter((one) => one.label === 'Planner' || one.href.startsWith('#/planner')),
      ).toEqual([]);
      expect(named.some((one) => one.current)).toBe(false);
    }
    expect(routeFromHash(PLANNER.hash('upgrades'))).toBe('planner');
  });

  it('sends the five old per-kind planner addresses to What to raise', () => {
    for (const kind of ['building', 'research', 'heroes', 'vehicle', 'pets']) {
      expect(routeFromHash(`#/planner/${kind}`)).toBe('planner');
      expect(PLANNER.fromHash(`#/planner/${kind}`)).toBe('raise');
      expect(plannerKindFromHash(`#/planner/${kind}`)).toBe(kind);
    }
    expect(plannerKindFromHash('#/planner/settings')).toBeNull();
    expect(plannerKindFromHash('#/planner')).toBeNull();
  });

  it("keeps our alliance views on the entry's Overview, but not past names, which depend on its data", () => {
    const page = ownPage(
      base({ route: 'alliance', allianceId: UUID, tabs: { alliance: 'activity' } }),
    );

    expect(page?.href).toBe(`#/alliance/${UUID}`);
    expect(page?.tabs?.map((tab) => [tab.label, tab.href])).toEqual([
      ['Overview', `#/alliance/${UUID}/overview`],
      ['Members', `#/alliance/${UUID}/members`],
      ['Ranking', `#/alliance/${UUID}/board`],
      ['Activity', `#/alliance/${UUID}/activity`],
      ['Against the server', `#/alliance/${UUID}/compare`],
    ]);
    expect(page?.tabs?.filter((tab) => tab.current).map((tab) => tab.href)).toEqual([
      `#/alliance/${UUID}/activity`,
    ]);
  });

  it('keeps Moves for an admin only, after Members', () => {
    const page = ownPage(
      admin({ route: 'alliance', allianceId: UUID, tabs: { alliance: 'moves' } }),
    );

    expect(page?.tabs?.map((tab) => tab.label)).toEqual([
      'Overview',
      'Members',
      'Moves',
      'Ranking',
      'Activity',
      'Against the server',
    ]);
    expect(page?.tabs?.filter((tab) => tab.current).map((tab) => tab.href)).toEqual([
      `#/alliance/${UUID}/moves`,
    ]);
    for (const ctx of [base(), base({ isOfficer: false })]) {
      expect(ownPage(ctx)).toBeDefined();
      expect(ownPage(ctx)?.tabs?.map((tab) => tab.label)).not.toContain('Moves');
    }
  });

  it('marks Overview for the bare address of our own page, and Activity for the retired one', () => {
    const marked = (hash: string) =>
      ownPage(
        base({
          route: routeFromHash(hash),
          allianceId: allianceIdFromHash(hash),
          tabs: { alliance: allianceViewFromHash(hash) ?? undefined },
        }),
      )
        ?.tabs?.filter((tab) => tab.current)
        .map((tab) => tab.label);

    expect(marked(`#/alliance/${UUID}`)).toEqual(['Overview']);
    expect(marked(`#/alliance/${UUID}/members`)).toEqual(['Members']);
    expect(marked(`#/alliance/${UUID}/power`)).toEqual(['Activity']);
    // Somebody else's page marks nothing of ours.
    expect(marked('#/alliance/33333333-3333-4333-8333-333333333301/members')).toEqual([]);
  });

  it('marks no alliance view while another screen is open', () => {
    const page = ownPage(base({ route: 'overview' }));

    expect(page).toBeDefined();
    expect(page?.current).toBe(false);
    expect(page?.tabs?.some((tab) => tab.current)).toBe(false);
  });
});
