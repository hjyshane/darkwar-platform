// Home with its reads mocked: what a member is shown first, and what an
// account with no character or no live plan is told instead of an error.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  playerId: 'p1' as string | null,
  plans: [] as unknown[],
  board: [] as unknown[],
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/useSession', () => ({
  useSession: () => ({
    data: { role: 'member', email: null, userId: 'u', playerId: mock.playerId },
  }),
}));
vi.mock('./homeData', () => ({
  useMyPlayer: () => ({ data: mock.playerId ? { name: 'Ann', serverId: 580 } : undefined }),
  useMyBlackGold: () => ({
    isPending: false,
    data: {
      readAt: '2026-11-16T13:00:00Z',
      row: { team_index: 1, state: 1 },
      objective: { label: 'Military Base A', role: 'hold', planName: 'Sunday A' },
    },
  }),
}));
vi.mock('../hive/hiveFormations', () => ({
  useFormations: () => ({ isPending: false, data: mock.plans }),
  useBoard: () => ({ data: mock.board }),
}));
vi.mock('../eventGuide/data', () => ({
  useEventGuide: () => ({ data: { themes: [], scores: [], calendar: [] } }),
  useCapturedTimes: () => ({ data: [] }),
}));
vi.mock('../overview/AnnouncementsBlock', () => ({ AnnouncementsBlock: () => <p>notices</p> }));
vi.mock('../overview/GuidesBlock', () => ({ GuidesBlock: () => <p>guides</p> }));

import { HomePage } from './HomePage';

const livePlan = {
  formationId: 'f1',
  name: 'Saturday move',
  serverId: 580,
  isActive: true,
  deletedAt: null,
  editedAt: '2026-11-18T21:52:00Z',
  editedByName: 'Officer',
};

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HomePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.playerId = 'p1';
  mock.plans = [livePlan];
  mock.board = [{ playerId: 'p1', x: 512, y: 300, label: '' }];
});

describe('HomePage', () => {
  it('puts my tile in the live hive plan first, as the game writes coordinates', () => {
    show();
    expect(screen.getByText('#580[X:512 Y:300]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy coordinates' })).toBeTruthy();
    expect(screen.getByText(/by Officer/)).toBeTruthy();
  });

  it('shows my Black Gold team and objective, and the calculator inside the upgrade card', () => {
    show();
    expect(
      screen.getByText(/You are on Team A, starter\. Your objective: Military Base A — hold\./),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Building' }).getAttribute('href')).toContain(
      '#/calculator?kind=building',
    );
    expect(screen.queryByText(/gift code/i)).toBeNull();
  });

  it('leaves the hive card out when no plan is live, and asks an unlinked account to link', () => {
    mock.plans = [];
    mock.playerId = null;
    show();
    expect(screen.queryByText(/Hive move/)).toBeNull();
    expect(screen.getByRole('link', { name: 'My account' })).toBeTruthy();
  });
});
