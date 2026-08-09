// The cache defaults, pinned.
//
// `new QueryClient()` bare means staleTime 0, and on this deployment that is
// expensive in a way it would not be elsewhere: the database is in us-east-2
// and the readers are not, so a request that does no work at all still costs
// 101-189 ms — measured against production with a one-row read of `servers`.
// With staleTime 0 every navigation re-asked everything it had just asked.
//
// This test exists because the failure is invisible. Reverting to the bare
// constructor breaks nothing, throws nothing, and shows up only as a screen
// that feels slow — which is how it went unnoticed until someone said "every
// page takes five seconds".
import { expect, test } from 'vitest';
import { queryClient } from '../src/App';

const defaults = () => queryClient.getDefaultOptions().queries;

test('a repeated question is not asked again for a minute', () => {
  // Safe only because FR-UI-005 exists: lib/realtime.ts invalidates the keys
  // a new capture affects, so this is a floor on unprompted refetching, not a
  // ceiling on freshness.
  expect(defaults()?.staleTime).toBe(60_000);
});

test('a screen keeps its answer longer than it trusts it', () => {
  // gcTime above staleTime is what makes going back show the last answer at
  // once and revalidate behind it, rather than blanking.
  expect(defaults()?.gcTime).toBeGreaterThan(defaults()?.staleTime as number);
});

test('refocusing a tab is not evidence that anything changed', () => {
  // Realtime says when something changed. Refetching on focus is another
  // 150 ms per query for an answer nobody asked for — and it is what made
  // the first realtime measurement in this app ambiguous, because a cell
  // updating could have been the socket or could have been the focus.
  expect(defaults()?.refetchOnWindowFocus).toBe(false);
});

test('a slow failure is not retried into four slow failures', () => {
  // The screens render a refusal rather than a crash — a 42501 is an answer —
  // so the default three-with-backoff mostly delays the message.
  expect(defaults()?.retry).toBe(1);
});
