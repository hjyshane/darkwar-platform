// The calculator's place in the app: its address, its sidebar entry, and who
// is offered it. The page is game-wide reference data, so a community account
// (0282) gets it beside the planner.
import { describe, expect, it } from 'vitest';
import { communityMayOpen } from '../../lib/communityAccess';
import { navSection, routeFromHash } from '../../lib/route';
import { type NavContext, buildNav } from '../../lib/shellNav';
import { tabKeyOf } from '../../lib/tabVisibility';
import { CALCULATOR_HASH } from './url';

const member: NavContext = {
  route: 'overview',
  allianceId: null,
  own: null,
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: false,
  seasonNames: {},
};

const items = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items);
/** The screens filed under one entry. */
const filed = (ctx: NavContext, label: string) =>
  (items(ctx).find((i) => i.label === label)?.children ?? []).map((c) => c.label);
/** Every entry and every screen filed under one. */
const everyLabel = (ctx: NavContext) =>
  items(ctx).flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)]);

describe('the calculator route', () => {
  it('is named by its address, with or without the state in the query', () => {
    expect(routeFromHash(CALCULATOR_HASH)).toBe('calculator');
    expect(routeFromHash('#/calculator?kind=chip&subject=4&to=10')).toBe('calculator');
    expect(navSection('calculator')).toBe('alliance');
  });

  it('is in the sidebar, with the planner under it and not beside it', () => {
    const labels = items(member).map((i) => i.label);
    expect(labels).toContain('Calculator');
    expect(labels).not.toContain('Planner');
    const entry = items({ ...member, route: 'calculator' }).find((i) => i.label === 'Calculator');
    expect(entry?.href).toBe(CALCULATOR_HASH);
    expect(entry?.current).toBe(true);
    expect(entry?.children?.map((child) => child.label)).toEqual([
      'Upgrade cost',
      'Resource wait time',
      'Virus resistance',
      'Planner',
    ]);
    expect(routeFromHash('#/calculator/resistance')).toBe('calculator');
  });

  it('is offered to a community account, and an admin can hide it like any tab', () => {
    expect(communityMayOpen('calculator')).toBe(true);
    expect(items({ ...member, isCommunity: true }).map((i) => i.label)).toContain('Calculator');
    expect(tabKeyOf('calculator')).toBe('calculator');
    const hidden = items({ ...member, tabShown: (tab) => tab !== 'calculator' });
    expect(hidden.map((i) => i.label)).not.toContain('Calculator');
  });

  it('keeps the four 2026-11-18 entries under the admin tab setting: the calculator for everybody, the other three in the Admin menu', () => {
    // They were taken out of the code that day and came back the same day:
    // whether a role sees them is Settings → Tab visibility (0295), not a code
    // change. Since 2026-11-19 gift codes, the game calendar and shop value are
    // filed in the admin's own group; the calculator is in everybody's menu.
    const admin = { ...member, isAdmin: true, isOfficer: true, mayManageGiftCodes: true };
    expect(items(admin).map((i) => i.label)).toContain('Calculator');
    expect(filed(admin, 'Roster')).toEqual(['Members', 'Gift codes']);
    expect(filed(admin, 'Game data')).toEqual(['Game calendar', 'Shop value']);
    const hidden = {
      ...admin,
      tabShown: (tab: string) => !['giftCodes', 'calendar', 'shopValue'].includes(tab),
    };
    expect(items(hidden).map((i) => i.label)).toContain('Calculator');
    expect(everyLabel(hidden)).not.toContain('Gift codes');
    expect(everyLabel(hidden)).not.toContain('Game calendar');
    expect(everyLabel(hidden)).not.toContain('Shop value');
    // An entry with nothing left under it is not drawn.
    expect(everyLabel(hidden)).not.toContain('Game data');
    // An officer has the member menu and the Officer menu: the calculator and
    // Gift codes, and neither of the game-data two.
    const officer = { ...member, isOfficer: true, mayManageGiftCodes: true };
    expect(items(officer).map((i) => i.label)).toContain('Calculator');
    expect(items(officer).map((i) => i.label)).toContain('Gift codes');
    for (const label of ['Game calendar', 'Shop value']) {
      expect(everyLabel(officer)).not.toContain(label);
    }
    // Tab visibility hides the officer's Gift codes like any tab.
    const officerHidden = { ...officer, tabShown: (tab: string) => tab !== 'giftCodes' };
    expect(everyLabel(officerHidden)).not.toContain('Gift codes');
  });
});
