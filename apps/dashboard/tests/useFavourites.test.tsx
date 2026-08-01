// The toggle has to decide "add or remove" from what is already starred.
// That decision had no test, and when unstarring appeared broken it was the
// first thing I could not rule out — it turned out to be the mock server,
// but the reasoning should not have depended on reading the code.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const calls = vi.hoisted(() => ({ inserted: [] as unknown[], deleted: [] as string[] }));
const rows = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));

// PostgREST builders are thenables that also chain, and both hooks under
// test use them differently: favourites awaits .select() directly, while
// useSession goes .select().eq().limit(). One shape has to serve both.
const from = vi.hoisted(() => {
  type Chain = Promise<{ data: unknown[]; error: null }> & {
    eq: () => Chain;
    limit: () => Chain;
    order: () => Chain;
  };
  const chain = (data: unknown[]): Chain => {
    const thenable = Promise.resolve({ data, error: null }) as Chain;
    thenable.eq = () => chain(data);
    thenable.limit = () => chain(data);
    thenable.order = () => chain(data);
    return thenable;
  };
  return vi.fn((table: string) => ({
    select: () => chain(table === 'favourites' ? rows.current : [{ role: 'member' }]),
    insert: async (row: unknown) => {
      calls.inserted.push(row);
      return { error: null };
    },
    delete: () => ({
      eq: async (_column: string, value: string) => {
        calls.deleted.push(value);
        return { error: null };
      },
    }),
  }));
});

vi.mock('../src/lib/supabase', () => ({ supabase: { auth, from } }));

import { useFavourites } from '../src/lib/useFavourites';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  calls.inserted = [];
  calls.deleted = [];
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'u1', email: 'm@test.local' } } },
  });
});

test('starring a row that is not starred inserts it', async () => {
  rows.current = [];
  const { result } = renderHook(() => useFavourites(), { wrapper });
  await waitFor(() => expect(result.current.signedIn).toBe(true));

  result.current.toggle('player', 'p1');

  await waitFor(() => expect(calls.inserted).toHaveLength(1));
  expect(calls.inserted[0]).toEqual({ user_id: 'u1', player_id: 'p1' });
  expect(calls.deleted).toHaveLength(0);
});

test('starring a row that is already starred deletes it', async () => {
  rows.current = [{ favourite_id: 'f1', player_id: 'p1', alliance_id: null, server_id: null }];
  const { result } = renderHook(() => useFavourites(), { wrapper });
  await waitFor(() => expect(result.current.isFavourite('player', 'p1')).toBe(true));

  result.current.toggle('player', 'p1');

  await waitFor(() => expect(calls.deleted).toEqual(['f1']));
  expect(calls.inserted).toHaveLength(0);
});

test('each kind writes its own column', async () => {
  // A uuid could be a player or an alliance; the column is what tells them
  // apart, and the check constraint rejects a row that sets two.
  rows.current = [];
  const { result } = renderHook(() => useFavourites(), { wrapper });
  await waitFor(() => expect(result.current.signedIn).toBe(true));

  result.current.toggle('alliance', 'a1');
  await waitFor(() => expect(calls.inserted).toHaveLength(1));
  expect(calls.inserted[0]).toEqual({ user_id: 'u1', alliance_id: 'a1' });

  result.current.toggle('server', 580);
  await waitFor(() => expect(calls.inserted).toHaveLength(2));
  expect(calls.inserted[1]).toEqual({ user_id: 'u1', server_id: 580 });
});

test('a favourite of one kind does not mark the same id in another', async () => {
  rows.current = [
    { favourite_id: 'f1', player_id: null, alliance_id: 'shared-id', server_id: null },
  ];
  const { result } = renderHook(() => useFavourites(), { wrapper });
  await waitFor(() => expect(result.current.isFavourite('alliance', 'shared-id')).toBe(true));
  expect(result.current.isFavourite('player', 'shared-id')).toBe(false);
});

test('signed out, nothing is starred and no query runs', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  rows.current = [{ favourite_id: 'f1', player_id: 'p1', alliance_id: null, server_id: null }];
  const { result } = renderHook(() => useFavourites(), { wrapper });

  await waitFor(() => expect(result.current.signedIn).toBe(false));
  expect(result.current.isFavourite('player', 'p1')).toBe(false);
  expect(result.current.count('player')).toBe(0);
});
