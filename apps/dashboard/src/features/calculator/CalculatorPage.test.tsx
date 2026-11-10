// The reference page with a known subject. Queries are mocked: what this pins
// is what the page draws from a link, not whether PostgREST answers.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subject } from '../planner/data';
import type { PlannedStep } from '../planner/plan';

const subject = (id: string, name: string, maxLevel: number, gameSeason: number | null = null) =>
  ({ subject: id, name, nameKo: null, maxLevel, category: null, gameSeason }) as Subject;

const step = (kind: PlannedStep['step']['kind'], subjectId: string, level: number) =>
  ({
    step: {
      kind,
      subject_id: subjectId,
      level,
      name: null,
      costs:
        kind === 'chip'
          ? [{ type: 'counter', id: 'chip_exp', amount: 60000 }]
          : [{ type: 'resource', id: '25', amount: 300000 }],
      seconds: kind === 'building' ? 3600 : null,
      requires: [],
    },
    prerequisite: false,
    goal: 0,
  }) as PlannedStep;

const mocks = vi.hoisted(() => ({
  fetchCalculatorSubjects: vi.fn(),
  loadSteps: vi.fn(),
  fetchExpCards: vi.fn(),
  fetchAccounts: vi.fn(),
}));

vi.mock('./data', () => ({
  fetchCalculatorSubjects: mocks.fetchCalculatorSubjects,
  loadSteps: mocks.loadSteps,
  fetchExpCards: mocks.fetchExpCards,
}));
vi.mock('../planner/data', () => ({
  fetchTiers: async () => new Map(),
  fetchMaterialNames: async () => ({ items: new Map(), resources: new Map([['25', 'Wood']]) }),
}));
vi.mock('../planner/accounts', () => ({ fetchAccounts: mocks.fetchAccounts }));
vi.mock('../../lib/gameIcons', () => ({
  useIcons: () => ({ data: undefined }),
  useItemIcons: () => ({ data: undefined }),
  GameIcon: () => null,
}));
vi.mock('../../lib/communityAccess', () => ({ useIsCommunity: () => false }));

import { CalculatorPage } from './CalculatorPage';

function open(hash: string) {
  window.location.hash = hash;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalculatorPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchCalculatorSubjects.mockImplementation(async (kind: string) =>
    kind === 'chip'
      ? [subject('4', 'Purple chip', 100)]
      : [subject('409000', 'Bank', 30), subject('868000', 'Mineral Factory I', 30, 6)],
  );
  mocks.loadSteps.mockImplementation(async (goals: { kind: string; subject: string }[]) => ({
    steps:
      goals[0]?.kind === 'chip'
        ? [step('chip', '4', 1)]
        : [step('building', '409000', 29), step('building', '409000', 30)],
    gaps: [],
  }));
  mocks.fetchExpCards.mockResolvedValue([{ itemId: '300030', name: 'Big card', amount: 60000 }]);
  mocks.fetchAccounts.mockResolvedValue([]);
});

describe('CalculatorPage', () => {
  it('draws totals, notes and a step table from the spec link', async () => {
    open('#/calculator?kind=building&subject=409000&from=28&to=30&speed=100&cost=50');

    // Totals: 2 × 300K wood at −50%, 2 × 1h at +100% speed.
    const totals = await screen.findByRole('group', { name: 'Totals' });
    // The material's name arrives with its own query, after the figures.
    expect(await within(totals).findByText('Wood')).toBeTruthy();
    expect(within(totals).getByText('300K')).toBeTruthy();
    expect(within(totals).getByText('1h 0m')).toBeTruthy();

    const table = screen.getByRole('table');
    expect(within(table).getByText('28 → 29')).toBeTruthy();
    expect(within(table).getByText('29 → 30')).toBeTruthy();
    expect(within(table).getAllByText('150K')).toHaveLength(2);
    expect(within(table).getByText('Total')).toBeTruthy();

    expect(screen.getByText(/Buildings this needs first are not included/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    // The planner goals asked for are exactly the link's range.
    expect(mocks.loadSteps).toHaveBeenCalledWith([
      { kind: 'building', subject: '409000', from: 28, to: 30 },
    ]);
  });

  it('says so when the link names a subject the catalogue does not have', async () => {
    open('#/calculator?kind=building&subject=123456&to=5');
    expect(
      await screen.findByText('This link names something the catalogue does not have.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(mocks.loadSteps).not.toHaveBeenCalled();
  });

  it('clamps a pasted range to the subject track before pricing it', async () => {
    open('#/calculator?kind=building&subject=409000&from=28&to=999');
    await screen.findByRole('table');
    expect(mocks.loadSteps).toHaveBeenCalledWith([
      { kind: 'building', subject: '409000', from: 28, to: 30 },
    ]);
  });

  it('shows buff fields and the hand-off only where they apply', async () => {
    mocks.fetchAccounts.mockResolvedValue([{ playerId: 'p1' }]);
    const first = open('#/calculator?kind=building&subject=409000&from=28&to=30');
    expect(await screen.findByRole('button', { name: 'Load into my plan' })).toBeTruthy();
    expect(screen.getByLabelText('Speed bonus %')).toBeTruthy();
    expect(screen.getByLabelText('Cost reduction %')).toBeTruthy();
    first.unmount();

    open('#/calculator?kind=chip&subject=4&to=1');
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Speed bonus %')).toBeNull();
    expect(screen.queryByLabelText('Cost reduction %')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load into my plan' })).toBeNull();
    // A chip range converts its EXP to cards from data.
    expect(screen.getByText('60K EXP = 1 × Big card (60,000 each)')).toBeTruthy();
  });

  it('hides the hand-off from a viewer with no planner account', async () => {
    open('#/calculator?kind=building&subject=409000&from=28&to=30');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Load into my plan' })).toBeNull();
  });

  it('asks for a subject before it shows anything', async () => {
    open('#/calculator');
    expect(await screen.findByText('Pick what to price.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a season building under the season entry', async () => {
    open('#/calculator?kind=building&subject=868000&to=2');
    await screen.findByRole('table');
    expect(screen.getByLabelText('Season')).toBeTruthy();
  });
});
