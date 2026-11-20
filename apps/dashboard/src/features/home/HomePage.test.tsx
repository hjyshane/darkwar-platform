// Home with its reads mocked: what a member is shown first, and what an
// account with no character or no live plan is told instead of an error.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  playerId: 'p1' as string | null,
  plans: [] as unknown[],
  board: [] as unknown[],
  zone: 'Asia/Seoul',
  times: [] as unknown[],
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/useSession', () => ({
  useSession: () => ({
    data: { role: 'member', email: null, userId: 'u', playerId: mock.playerId },
  }),
}));
vi.mock('../../lib/timezone', async (original) => ({
  ...(await original<typeof import('../../lib/timezone')>()),
  browserZone: () => mock.zone,
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
  useCapturedTimes: () => ({ data: mock.times }),
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
  mock.zone = 'Asia/Seoul';
  mock.times = [];
  const base = { label: '', spanX: 3, spanY: 3, kind: 'base', colour: null };
  mock.board = [
    { ...base, slotId: 's1', playerId: 'p1', x: 512, y: 300 },
    { ...base, slotId: 's2', playerId: 'p2', x: 515, y: 303 },
    { ...base, slotId: 's3', playerId: null, x: 509, y: 300, colour: 'red' },
  ];
});

describe('HomePage', () => {
  it('puts my tile in the live hive plan first, as the game writes coordinates', () => {
    show();
    expect(screen.getByText('#580[X:512 Y:300]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy coordinates' })).toBeTruthy();
    expect(screen.getByText(/by Officer/)).toBeTruthy();
  });

  it('draws the plan small under the coordinate with my base picked out', () => {
    const { container } = show();
    expect(screen.getByRole('link', { name: /Your base on the plan map/ })).toBeTruthy();
    expect(container.querySelectorAll('.hive-snap__tile').length).toBe(3);
    const own = container.querySelectorAll('.hive-snap__tile--own');
    expect(own.length).toBe(1);
    // West of p2 and south of it: x counts east, and the picture's y is the
    // map's y turned over, so the more northern base is nearer the top.
    const other = container.querySelector(
      '.hive-snap__tile:not(.hive-snap__tile--own):not(.hive-snap__tile--red)',
    );
    expect(Number(own[0]?.getAttribute('x'))).toBeLessThan(Number(other?.getAttribute('x')));
    expect(Number(own[0]?.getAttribute('y'))).toBeGreaterThan(Number(other?.getAttribute('y')));
  });

  it('leaves the picture out when I have no tile in the plan', () => {
    mock.playerId = 'p9';
    const { container } = show();
    expect(screen.getByText('You have no tile in this plan.')).toBeTruthy();
    expect(container.querySelector('.hive-snap')).toBeNull();
  });

  it('puts the pinned notices above the hive card', () => {
    show();
    const notices = screen.getByText('notices');
    const hive = screen.getByText(/Hive move/);
    expect(notices.compareDocumentPosition(hive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives the next Black Gold time on my own clock beside server time', () => {
    mock.times = [{ title: 'Black Gold · Team A', startsAt: '2099-01-03T22:30:00Z' }];
    show();
    // 22:30 UTC is 20:30 server time on the 3rd and 07:30 in Seoul on the 4th.
    expect(screen.getByText(/^Sat 20:30/)).toBeTruthy();
    expect(screen.getByText('Sun 07:30 your time')).toBeTruthy();
  });

  it('does not repeat the time for a reader whose clock is server time', () => {
    mock.zone = 'Etc/GMT+2';
    mock.times = [{ title: 'Black Gold · Team A', startsAt: '2099-01-03T22:30:00Z' }];
    show();
    expect(screen.queryByText(/your time/)).toBeNull();
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
