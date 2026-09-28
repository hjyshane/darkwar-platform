// The header is how 0193's active_alliance() learns which alliance a request
// is about. No header must mean the plain request — a single-alliance install
// and a signed-out visitor never choose, and must not send an empty value.
import { afterEach, expect, test, vi } from 'vitest';
import {
  fetchWithAlliance,
  getActiveAlliance,
  isViewedAlliance,
  setActiveAlliance,
} from '../src/lib/activeAlliance';

const fetchSpy = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'),
);
vi.stubGlobal('fetch', fetchSpy);

afterEach(() => {
  setActiveAlliance(null);
  fetchSpy.mockClear();
});

test('with nothing chosen the request goes out untouched', async () => {
  await fetchWithAlliance('https://x.test/rest/v1/alliances', { headers: { apikey: 'k' } });
  const init = fetchSpy.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).has('x-alliance-id')).toBe(false);
});

test('a chosen alliance rides on every request, beside the existing headers', async () => {
  setActiveAlliance('00000000-0000-4000-8000-00000000a001');
  await fetchWithAlliance('https://x.test/rest/v1/rpc/x', { headers: { apikey: 'k' } });
  const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
  expect(headers.get('x-alliance-id')).toBe('00000000-0000-4000-8000-00000000a001');
  expect(headers.get('apikey')).toBe('k');
});

test('the choice survives a reload through localStorage', () => {
  setActiveAlliance('00000000-0000-4000-8000-00000000a002');
  expect(window.localStorage.getItem('dw-active-alliance')).toBe(
    '00000000-0000-4000-8000-00000000a002',
  );
  expect(getActiveAlliance()).toBe('00000000-0000-4000-8000-00000000a002');
});

test('"ours" means one of ours AND the one being viewed', () => {
  // Nothing chosen: a single-alliance install or a signed-out visitor, where
  // is_own is the whole answer, as it was before two alliances could be ours.
  expect(isViewedAlliance('a', true)).toBe(true);
  expect(isViewedAlliance('a', false)).toBe(false);

  setActiveAlliance('b');
  expect(isViewedAlliance('b', true)).toBe(true);
  // The other own alliance: its member data is withheld now, so its page must
  // not offer those blocks, and a chart must not highlight it as ours.
  expect(isViewedAlliance('a', true)).toBe(false);
  expect(isViewedAlliance('b', false)).toBe(false);
});
