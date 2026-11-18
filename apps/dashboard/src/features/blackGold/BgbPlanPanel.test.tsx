// The battle plan panel with its data layer mocked: what a member is told,
// and what an officer's save sends. Whether PostgREST answers is pgTAP's job
// (supabase/tests/331_bgb_plans_test.sql).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  role: 'member' as string,
  playerId: 'p1' as string | null,
  plans: [] as unknown[],
  detail: null as unknown,
  savePlan: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/useSession', () => ({
  useSession: () => ({
    data: { role: mock.role, email: null, userId: 'u-1', playerId: mock.playerId },
  }),
}));
vi.mock('../../lib/permissions', async (original) => ({
  ...(await original<typeof import('../../lib/permissions')>()),
  usePermissions: () => ({
    data: {
      capabilities: [],
      grants: [{ role: 'officer', capability: 'hive.plan', allowed: true }],
    },
  }),
}));
vi.mock('../../lib/useMyAlliances', () => ({
  useActiveAlliance: () => ({
    active: { alliance_id: 'a1', name: 'A', code: 'A', server_id: 580, role: 'officer' },
    alliances: [],
    switchTo: () => undefined,
  }),
}));
vi.mock('./bgbPlanData', () => ({
  usePlans: () => ({ data: mock.plans, isPending: false, error: null }),
  usePlanDetail: () => ({ data: mock.detail, isPending: false, error: null }),
  useStarters: () => ({
    data: {
      readAt: '2026-11-16T13:00:00Z',
      starters: [
        { playerId: 'p1', name: 'Ann', power: 9 },
        { playerId: 'p2', name: 'Ben', power: 8 },
      ],
    },
    isPending: false,
    error: null,
  }),
  createPlan: vi.fn(),
  savePlan: mock.savePlan,
  makeLive: vi.fn(),
  deletePlan: vi.fn(),
  restorePlan: vi.fn(),
}));

import { BgbPlanPanel } from './BgbPlanPanel';

const livePlan = {
  planId: 'plan-1',
  teamIndex: 1,
  name: 'Sunday A',
  note: '',
  isLive: true,
  version: 3,
  editedAt: '2026-11-17T00:00:00Z',
  editedByName: 'Officer',
  deletedAt: null,
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BgbPlanPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.role = 'member';
  mock.playerId = 'p1';
  mock.plans = [livePlan];
  mock.detail = {
    version: 3,
    assignments: [
      { playerId: 'p1', playerName: 'Ann', objectiveKey: 'mil-a', role: 'hold', ordinal: 0 },
      { playerId: 'p2', playerName: 'Ben', objectiveKey: 'factory', role: '', ordinal: 1 },
    ],
  };
});

describe('BgbPlanPanel', () => {
  it('tells a member their own objective first', () => {
    show();
    expect(screen.getByText(/Your objective: Military Base A — hold/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save plan|Saved/ })).toBeNull();
  });

  it('says so when no plan is live', () => {
    mock.plans = [{ ...livePlan, isLive: false }];
    show();
    expect(screen.getByText(/No plan is live for this team yet/)).toBeTruthy();
  });

  it('lets an officer move a starter and saves against the version it was built from', async () => {
    mock.role = 'officer';
    mock.savePlan.mockResolvedValue(4);
    show();
    const save = screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Objective for Ben'), { target: { value: 'oil-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(mock.savePlan).toHaveBeenCalledTimes(1));
    expect(mock.savePlan.mock.calls[0]?.[0]).toMatchObject({
      planId: 'plan-1',
      version: 3,
      assignments: [
        { objective_key: 'mil-a', player_id: 'p1', role: 'hold', ordinal: 0 },
        { objective_key: 'oil-2', player_id: 'p2', role: '', ordinal: 1 },
      ],
    });
  });
});
