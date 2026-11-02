import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MigrationAnalytics } from './MigrationAnalytics';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./movers', () => ({
  fetchMovers: async () => [
    {
      game_uid: 5_000_588,
      name: 'Alpha',
      home_server: 588,
      server_id: 580,
      alliance_name: null,
      power: 900,
      board_rank: 3,
      captured_at: '2026-11-02T07:00:00Z',
      source: 'list',
    },
    {
      game_uid: 6_000_577,
      name: 'Beta',
      home_server: 577,
      server_id: 580,
      alliance_name: null,
      power: 100,
      board_rank: 4000,
      captured_at: '2026-11-02T07:00:00Z',
      source: 'roster',
    },
  ],
}));
vi.mock('./candidates', async (original) => ({
  ...(await original<typeof import('./candidates')>()),
  fetchBoardInfo: async () => null,
  fetchTierBoard: async () => [
    {
      overall_rank: 3,
      game_uid: 5_000_588,
      name: 'Alpha',
      server_id: 580,
      alliance_name: null,
      power: 900,
      captured_at: '2026-11-02T07:00:00Z',
    },
  ],
}));

afterEach(cleanup);

describe('MigrationAnalytics', () => {
  test('charts the movers it was given and asks for a baseline when there is none', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MigrationAnalytics eventId={null} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText('Net players per server (arrived − left), all tiers'),
    ).toBeTruthy();
    expect(screen.getByText('+2 (+2 / −0)')).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
    expect(screen.getByText(/Set up a migration with a baseline/)).toBeTruthy();
  });
});
