// The channel list every post editor and the schedule's boards read.
//
// The bug these pin: the query asked for `enabled` and then ignored it, so a
// switched-off channel was offered in all three pickers. Picking one produced a
// post that announced NOWHERE — both deliverers (`NotifyWorker.deliver` and
// `internal.deliver_owned_alerts`) look the webhook up with `enabled` in the
// condition and skip the row when they find nothing. That skip is deliberate on
// their side, so this list is the only place the mistake can be caught.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

// `vi.hoisted` because `vi.mock` is lifted above the imports, so a plain `const`
// here is still in the temporal dead zone when the factory runs.
const { order, eq, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq, order }));
  const from = vi.fn(() => ({ select }));
  return { order, eq, select, from };
});

vi.mock('../src/lib/supabase', () => ({ supabase: { from } }));

import { useChannelNames } from '../src/lib/channels';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  order.mockResolvedValue({
    data: [{ channel: 'game-events', enabled: true }],
    error: null,
  });
});

test('only switched-on channels are asked for', async () => {
  const { result } = renderHook(() => useChannelNames(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  // The filter goes to PostgREST rather than being applied after the fact: the
  // rows are small, but doing it here means every caller has to remember to.
  expect(eq).toHaveBeenCalledWith('enabled', true);
  expect(result.current.data).toEqual(['game-events']);
});

test('a channel with no name is dropped rather than rendered as a blank box', async () => {
  order.mockResolvedValue({
    data: [
      { channel: 'game-events', enabled: true },
      { channel: null, enabled: true },
    ],
    error: null,
  });
  const { result } = renderHook(() => useChannelNames(), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());

  expect(result.current.data).toEqual(['game-events']);
});
