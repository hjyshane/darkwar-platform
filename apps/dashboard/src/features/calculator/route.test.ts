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

  it('has no sidebar entry (hidden 2026-11-18), and neither has the archived planner', () => {
    const labels = items(member).map((i) => i.label);
    expect(labels).not.toContain('Calculator');
    expect(labels).not.toContain('Planner');
    expect(labels).not.toContain('Gift codes');
    expect(labels).not.toContain('Game calendar');
    expect(labels).not.toContain('Shop value');
    expect(routeFromHash(CALCULATOR_HASH)).toBe('calculator');
  });

  it('is still open to a community account by address', () => {
    expect(communityMayOpen('calculator')).toBe(true);
    expect(tabKeyOf('calculator')).toBe('calculator');
  });
});
