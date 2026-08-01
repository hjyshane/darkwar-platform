// The gameplay screens each have an address; the month-card page has one
// but is deliberately not linked (see route.ts).
import { expect, test } from 'vitest';
import { NAV_TABS, routeFromHash, serverHash, serverIdFromHash } from '../src/lib/route';

test('each screen has its own address', () => {
  expect(routeFromHash('#/rankings')).toBe('rankings');
  expect(routeFromHash('#/cross-server')).toBe('crossRankings');
  expect(routeFromHash('#/arena')).toBe('arena');
  expect(routeFromHash('#/month-cards')).toBe('monthCards');
  expect(routeFromHash('#/login')).toBe('login');
});

test('an unknown address lands on the dashboard rather than nothing', () => {
  expect(routeFromHash('')).toBe('dashboard');
  expect(routeFromHash('#/')).toBe('dashboard');
  expect(routeFromHash('#/nope')).toBe('dashboard');
  expect(routeFromHash('#/arena/extra')).toBe('dashboard');
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
    expect(routeFromHash(hash)).toBe('dashboard');
    expect(serverIdFromHash(hash)).toBeNull();
  }
});

test('the other addresses carry no server', () => {
  expect(serverIdFromHash('#/arena')).toBeNull();
  expect(serverIdFromHash('')).toBeNull();
});
