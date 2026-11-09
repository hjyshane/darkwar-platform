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

describe('the calculator route', () => {
  it('is named by its address, with or without the state in the query', () => {
    expect(routeFromHash(CALCULATOR_HASH)).toBe('calculator');
    expect(routeFromHash('#/calculator?kind=chip&subject=4&to=10')).toBe('calculator');
    expect(navSection('calculator')).toBe('alliance');
  });

  it('sits straight after the planner in the sidebar', () => {
    const labels = items(member).map((i) => i.label);
    expect(labels).toContain('Calculator');
    expect(labels.indexOf('Calculator')).toBe(labels.indexOf('Planner') + 1);
    const entry = items({ ...member, route: 'calculator' }).find((i) => i.label === 'Calculator');
    expect(entry?.href).toBe(CALCULATOR_HASH);
    expect(entry?.current).toBe(true);
    expect(entry?.children).toBeUndefined();
  });

  it('is offered to a community account, and an admin can hide it like any tab', () => {
    expect(communityMayOpen('calculator')).toBe(true);
    expect(items({ ...member, isCommunity: true }).map((i) => i.label)).toContain('Calculator');
    expect(tabKeyOf('calculator')).toBe('calculator');
    const hidden = items({ ...member, tabShown: (tab) => tab !== 'calculator' });
    expect(hidden.map((i) => i.label)).not.toContain('Calculator');
  });
});
