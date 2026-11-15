// The guide's "captured times" list: what it asks the database for.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vitest';

type Op = [method: string, args: unknown[]];

// `vi.hoisted` because `vi.mock` is lifted above the imports.
const db = vi.hoisted(() => {
  const ops: Op[] = [];
  const chain: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        }
        return (...args: unknown[]) => {
          ops.push([String(prop), args]);
          return chain;
        };
      },
    },
  );
  return { ops, chain };
});

vi.mock('../../lib/supabase', () => ({ supabase: db.chain }));

import { useCapturedTimes } from './data';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

test('captured times leave out hidden entries and the calendar ones (0325)', async () => {
  const { result } = renderHook(() => useCapturedTimes(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  expect(db.ops).toContainEqual(['from', ['schedule_events']]);
  // An officer hid it on the Alarms tab: the guide does not bring it back.
  expect(db.ops).toContainEqual(['eq', ['hidden', false]]);
  // Calendar entries (`cal:`) would crowd the alliance's picks out of 30 rows;
  // a captured entry with no key at all is still a pick.
  expect(db.ops).toContainEqual(['or', ['source_key.is.null,source_key.not.like.cal:*']]);
});
