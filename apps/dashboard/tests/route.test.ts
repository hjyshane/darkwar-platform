// The gameplay screens each have an address; the month-card page has one
// but is deliberately not linked (see route.ts).
import { expect, test } from 'vitest';
import {
  ADMIN_GROUPS,
  NAV_TABS,
  RANKING_TABS,
  adminGroupFromHash,
  adminHash,
  adminSectionFromHash,
  isRankingRoute,
  routeFromHash,
  serverHash,
  serverIdFromHash,
} from '../src/lib/route';

test('each screen has its own address', () => {
  expect(routeFromHash('#/rankings')).toBe('rankings');
  expect(routeFromHash('#/cross-server')).toBe('crossRankings');
  expect(routeFromHash('#/arena')).toBe('arena');
  expect(routeFromHash('#/month-cards')).toBe('monthCards');
  expect(routeFromHash('#/login')).toBe('login');
});

test('an unknown address lands on the dashboard rather than nothing', () => {
  expect(routeFromHash('')).toBe('overview');
  expect(routeFromHash('#/')).toBe('overview');
  expect(routeFromHash('#/nope')).toBe('overview');
  expect(routeFromHash('#/arena/extra')).toBe('overview');
});

test('every tab address resolves back to the route it claims', () => {
  // A typo here would not throw. The tab would simply never look selected,
  // because aria-current compares exactly these two values.
  for (const tab of NAV_TABS) {
    expect(routeFromHash(tab.hash)).toBe(tab.route);
  }
});

test('the month-card page is not in the navigation', () => {
  // RLS is the real boundary; this keeps finance out of the gameplay
  // screens, and it is easy to undo by accident when adding the next tab.
  expect(NAV_TABS.some((tab) => tab.route === 'monthCards')).toBe(false);
});

test('sign-in is an account action, not a screen', () => {
  expect(NAV_TABS.some((tab) => tab.route === 'login')).toBe(false);
});

test('no two tabs share an address', () => {
  const hashes = NAV_TABS.map((tab) => tab.hash);
  expect(new Set(hashes).size).toBe(hashes.length);
});

test('a server address carries which server', () => {
  expect(routeFromHash('#/server/580')).toBe('server');
  expect(serverIdFromHash('#/server/580')).toBe(580);
  expect(serverHash(584)).toBe('#/server/584');
  expect(routeFromHash(serverHash(577))).toBe('server');
  expect(serverIdFromHash(serverHash(577))).toBe(577);
});

test('anything that is not a plain server number is not a server page', () => {
  // The id reaches a query, so it has to be digits — not "580; drop", not a
  // name, not empty. Everything else falls through to the dashboard.
  for (const hash of ['#/server/', '#/server/abc', '#/server/580/extra', '#/server/-1']) {
    expect(routeFromHash(hash)).toBe('overview');
    expect(serverIdFromHash(hash)).toBeNull();
  }
});

test('every settings group has its own address', () => {
  for (const entry of ADMIN_GROUPS) {
    expect(routeFromHash(adminHash(entry.group))).toBe('admin');
    expect(adminGroupFromHash(adminHash(entry.group))).toBe(entry.group);
  }
});

test('bare #/admin is Access, because that address is already in use', () => {
  // It is in the nav, in browser history, and in the docs. Sending it
  // somewhere it does not resolve would break all three at once.
  expect(routeFromHash('#/admin')).toBe('admin');
  expect(adminGroupFromHash('#/admin')).toBe('access');
});

test('an invented group is not a settings page', () => {
  // Falling back to Access would render a working-looking screen for an
  // address that means nothing, the same trap `#/arena/extra` avoids.
  for (const hash of ['#/admin/nope', '#/admin/', '#/admin/ACCESS']) {
    expect(routeFromHash(hash)).toBe('overview');
    expect(adminGroupFromHash(hash)).toBeNull();
  }
});

test('an invented SECTION lands on the group it named', () => {
  // `#/admin/access/extra` used to be in the list above. The rule narrowed
  // when settings gained one address per section: the GROUP is still checked
  // against a real list, but the section is not, because the slugs live in
  // `adminAccess.ts` alongside the capability each panel needs — and that
  // file already imports from this one. Validating them here would mean
  // either a second copy of the list to drift, or a module cycle.
  //
  // The failure mode this leaves is mild and the group bar shows it: Access
  // with its first panel open, which is what `#/admin/access` gives anyway.
  // An invented GROUP still resolves nowhere.
  expect(routeFromHash('#/admin/access/extra')).toBe('admin');
  expect(adminGroupFromHash('#/admin/access/extra')).toBe('access');
  expect(adminSectionFromHash('#/admin/access/extra')).toBe('extra');
});

test('a settings address carries its section, and the bare one does not', () => {
  expect(adminSectionFromHash('#/admin/access/permissions')).toBe('permissions');
  // Null means "the group's first section" — which section that is belongs to
  // the settings list, not to the address parser.
  expect(adminSectionFromHash('#/admin/access')).toBeNull();
  expect(adminSectionFromHash('#/admin')).toBeNull();
  expect(adminHash('display', 'formulas')).toBe('#/admin/display/formulas');
  expect(adminHash('display')).toBe('#/admin/display');
});

test('the other addresses name no settings group', () => {
  expect(adminGroupFromHash('#/members')).toBeNull();
  expect(adminGroupFromHash('')).toBeNull();
});

test('no two settings groups share a name', () => {
  const groups = ADMIN_GROUPS.map((entry) => entry.group);
  expect(new Set(groups).size).toBe(groups.length);
});

test('the other addresses carry no server', () => {
  expect(serverIdFromHash('#/arena')).toBeNull();
  expect(serverIdFromHash('')).toBeNull();
});

test('every ranking sub-tab address resolves back to the route it claims', () => {
  // Same check NAV_TABS gets, and it matters more here: these three stopped
  // being top-level tabs, so a typo would show an empty second row rather than
  // a missing tab somebody would notice.
  for (const tab of RANKING_TABS) {
    expect(routeFromHash(tab.hash)).toBe(tab.route);
    expect(isRankingRoute(tab.route)).toBe(true);
  }
});

test('the ranking tab stands for all three of its boards', () => {
  // The top-level tab points at Alliance Ranking but stays selected on the
  // other two — otherwise opening Arena deselects the tab that got you there.
  expect(NAV_TABS.some((tab) => tab.route === 'rankings')).toBe(true);
  expect(isRankingRoute('arena')).toBe(true);
  expect(isRankingRoute('crossRankings')).toBe(true);
  // And not for anything else, or every screen would light it up.
  expect(isRankingRoute('overview')).toBe(false);
  expect(isRankingRoute('members')).toBe(false);
});

test('members and the ranking boards are no longer top-level tabs', () => {
  // They moved under our own alliance and under Cross-Server Ranking. Left in
  // NAV_TABS as well they would appear twice, which is how a nav bar quietly
  // grows back to nine tabs on a phone.
  for (const route of ['members', 'crossRankings', 'arena'] as const) {
    expect(NAV_TABS.some((tab) => tab.route === route)).toBe(false);
  }
});
