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
    expect(allianceHash(UUID)).toBe(`#/alliance/${UUID}`);
    expect(allianceViewFromHash(`#/alliance/${UUID}`)).toBe('members');
  });
});

const base = (over: Partial<NavContext> = {}): NavContext => ({
  route: 'overview',
  allianceId: null,
  own: { alliance_id: UUID, label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: false,
  seasonNames: {},
  ...over,
});

const entry = (ctx: NavContext, group: string, label: string): NavItem | undefined =>
  buildNav(ctx)
    .find((candidate) => candidate.id === group)
    ?.items.find((candidate) => candidate.label === label);

describe('sidebar tabs for the alliance screens', () => {
  it('lists the two ranking tabs under Members, marking the open one', () => {
    const members = entry(
      base({ route: 'members', tabs: { members: 'running' } }),
      'alliance',
      'Members',
    );

    expect(members?.children?.map((child) => [child.label, child.href, child.current])).toEqual([
      ['Last ranking', '#/members', false],
      ['This ranking · weekly', '#/members/running', true],
    ]);
  });

  it('lists the hive tabs to a planner only', () => {
    const labels = (mayPlanHive: boolean | undefined) =>
      entry(base({ route: 'hive', mayPlanHive }), 'alliance', 'Hive')?.children?.map(
        (child) => child.label,
      );

    expect(labels(true)).toEqual(['Plan', 'Draw the shape', 'Who goes where']);
    expect(labels(false)).toBeUndefined();
    expect(labels(undefined)).toBeUndefined();
  });

  it('lists the three planner pages', () => {
    const planner = entry(
      base({ route: 'planner', tabs: { planner: 'upgrades' } }),
      'alliance',
      'Planner',
    );

    expect(planner?.children?.map((child) => child.label)).toEqual([
      'What to raise',
      'Settings',
      'Next upgrades',
    ]);
    expect(planner?.children?.filter((child) => child.current).map((child) => child.label)).toEqual(
      ['Next upgrades'],
    );
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

  it('lists our alliance views, but not past names, which depend on its data', () => {
    const own = entry(
      base({ route: 'alliance', allianceId: UUID, tabs: { alliance: 'power' } }),
      'alliance',
      'CBFW',
    );

    expect(own?.children?.map((child) => child.label)).toEqual([
      'Members',
      'Ranking',
      'Power and towers',
      'Activity',
      'Against the server',
    ]);
    expect(own?.children?.find((child) => child.current)?.href).toBe(`#/alliance/${UUID}/power`);
  });

  it('marks no alliance view while another screen is open', () => {
    const own = entry(base({ route: 'overview' }), 'alliance', 'CBFW');

    expect(own?.children?.some((child) => child.current)).toBe(false);
  });
});
