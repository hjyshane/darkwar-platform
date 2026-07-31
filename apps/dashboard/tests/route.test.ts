// The gameplay screens each have an address; the month-card page has one
// but is deliberately not linked (see route.ts).
import { expect, test } from 'vitest';
import { NAV_TABS, routeFromHash } from '../src/lib/route';

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
