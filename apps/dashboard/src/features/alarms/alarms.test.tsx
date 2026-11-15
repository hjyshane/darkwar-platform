// The Alarms tab's writes and one read, against a supabase stand-in that
// records every call in the chain: which table, which filters, which payload.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Op = [method: string, args: unknown[]];

// `vi.hoisted` because `vi.mock` is lifted above the imports.
const db = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const state = { data: [] as unknown, error: null as unknown };
  function from(table: string) {
    const entry = { table, ops: [] as Op[] };
    calls.push(entry);
    // Every method returns the chain; awaiting it gives the canned answer.
    const chain: object = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: state.data, error: state.error });
          }
          return (...args: unknown[]) => {
            entry.ops.push([String(prop), args]);
            return chain;
          };
        },
      },
    );
    return chain;
  }
  return { calls, state, from };
});

vi.mock('../../lib/supabase', () => ({ supabase: { from: db.from } }));

import type { AlarmStep } from './alarmLogic';
import { useCreateBoard, useDeleteBoard, useSaveEntryAlarms, useUnplacedPicks } from './alarms';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ops = (table: string) => db.calls.filter((c) => c.table === table).map((c) => c.ops);
const step = (minutesBefore: number, enabled = true): AlarmStep => ({
  reminderId: `r-${minutesBefore}`,
  anchor: 'start',
  minutesBefore,
  sendAt: null,
  enabled,
});

beforeEach(() => {
  db.calls.length = 0;
  db.state.data = [];
  db.state.error = null;
});

describe('useSaveEntryAlarms', () => {
  test('a step change alone leaves the saved message alone', async () => {
    const { result } = renderHook(() => useSaveEntryAlarms(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        entryId: 'ev-1',
        message: null,
        current: [step(60)],
        desired: [step(60, false)],
      }),
    );
    // Another officer's message, saved since this page loaded, stays.
    expect(ops('schedule_events')).toEqual([]);
    expect(ops('schedule_reminders')).toEqual([
      [
        ['update', [{ enabled: false }]],
        ['eq', ['schedule_event_id', 'ev-1']],
        ['eq', ['reminder_id', 'r-60']],
      ],
    ]);
  });

  test('an edited message is written, filtered to its entry', async () => {
    const { result } = renderHook(() => useSaveEntryAlarms(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        entryId: 'ev-1',
        message: '  Rally {in}  ',
        current: [step(60)],
        desired: [step(60)],
      }),
    );
    expect(ops('schedule_events')).toEqual([
      [
        ['update', [{ alarm_message: 'Rally {in}' }]],
        ['eq', ['schedule_event_id', 'ev-1']],
      ],
    ]);
  });
});

describe('boards', () => {
  test('a new board takes a key derived from its label, free in the alliance', async () => {
    const { result } = renderHook(() => useCreateBoard(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ label: ' Bear Hunt ', kind: 'point', taken: ['bear-hunt'] }),
    );
    // A point board's steps are the column defaults: not sent.
    expect(ops('schedule_categories')).toEqual([
      [['insert', [{ category: 'bear-hunt-2', label: 'Bear Hunt', kind: 'point' }]]],
    ]);
  });

  test('a new window board has no countdown to its opening', async () => {
    const { result } = renderHook(() => useCreateBoard(), { wrapper });
    await act(() => result.current.mutateAsync({ label: 'Sign-up', kind: 'window', taken: [] }));
    expect(ops('schedule_categories')[0]).toEqual([
      ['insert', [{ category: 'sign-up', label: 'Sign-up', kind: 'window', start_reminders: [] }]],
    ]);
  });

  test('a board needs a name', async () => {
    const { result } = renderHook(() => useCreateBoard(), { wrapper });
    await expect(
      act(() => result.current.mutateAsync({ label: '   ', kind: 'point', taken: [] })),
    ).rejects.toThrow(/name/);
    expect(db.calls).toEqual([]);
  });

  test('deleting a board names it in the filter', async () => {
    const { result } = renderHook(() => useDeleteBoard(), { wrapper });
    await act(() => result.current.mutateAsync('bear-hunt'));
    expect(ops('schedule_categories')).toEqual([
      [
        ['delete', []],
        ['eq', ['category', 'bear-hunt']],
      ],
    ]);
  });
});

describe('useUnplacedPicks', () => {
  test("filters by the alliance's server in the query, not after the row cap", async () => {
    const { result } = renderHook(() => useUnplacedPicks(581), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(ops('alliance_event_times')[0]).toContainEqual([
      'eq',
      ['collected_from_server_id', 581],
    ]);
  });

  test('with the server unknown, every unplaced pick is asked for', async () => {
    const { result } = renderHook(() => useUnplacedPicks(null), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(ops('alliance_event_times')[0]?.some(([method]) => method === 'eq')).toBe(false);
  });
});
