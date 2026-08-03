// The gameplay screens each have an address; the month-card page has one
// but is deliberately not linked (see route.ts).
import { expect, test } from 'vitest';
import {
  ADMIN_GROUPS,
  NAV_TABS,
  adminGroupFromHash,
  adminHash,
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
  for (const hash of ['#/admin/nope', '#/admin/', '#/admin/access/extra', '#/admin/ACCESS']) {
    expect(routeFromHash(hash)).toBe('overview');
    expect(adminGroupFromHash(hash)).toBeNull();
  }
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
