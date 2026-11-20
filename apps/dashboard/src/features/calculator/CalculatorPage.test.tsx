// The reference page with a known subject. Queries are mocked: what this pins
// is what the page draws from a link, not whether PostgREST answers.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subject } from '../planner/data';
import type { PlannedStep } from '../planner/plan';

const subject = (
  id: string,
  name: string,
  maxLevel: number,
  gameSeason: number | null = null,
  category: number | null = null,
) => ({ subject: id, name, nameKo: null, maxLevel, category, gameSeason }) as Subject;

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
}));

vi.mock('./data', () => ({
  fetchCalculatorSubjects: mocks.fetchCalculatorSubjects,
  loadSteps: mocks.loadSteps,
  fetchExpCards: mocks.fetchExpCards,
}));
vi.mock('../planner/data', () => ({
  fetchTiers: async () => new Map(),
  fetchResearchTabs: async () => [
    { tabId: 1003, name: 'New Home' },
    { tabId: 1007, name: 'Battle' },
  ],
  fetchMaterialNames: async () => ({ items: new Map(), resources: new Map([['25', 'Wood']]) }),
}));
vi.mock('../../lib/gameIcons', () => ({
  useIcons: () => ({ data: undefined }),
  useItemIcons: () => ({ data: undefined }),
  GameIcon: () => null,
}));

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
  mocks.fetchCalculatorSubjects.mockImplementation(async (kind: string) => {
    if (kind === 'chip') return [subject('4', 'Purple chip', 100)];
    if (kind === 'vehicle_part') return [subject('1', 'Vehicle part (any)', 66)];
    if (kind === 'research') {
      return [
        subject('7001', 'Marching Speed', 10, null, 1007),
        subject('3001', 'Fast Building', 10, null, 1003),
        subject('9001', 'Other screen', 10, null, 7),
      ];
    }
    return [subject('409000', 'Bank', 30), subject('868000', 'Mineral Factory I', 30, 6)];
  });
  mocks.loadSteps.mockImplementation(async (goals: { kind: string; subject: string }[]) => ({
    steps:
      goals[0]?.kind === 'chip'
        ? [step('chip', '4', 1)]
        : [step('building', '409000', 29), step('building', '409000', 30)],
    gaps: [],
  }));
  mocks.fetchExpCards.mockResolvedValue([{ itemId: '300030', name: 'Big card', amount: 60000 }]);
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

  it('shows buff fields only where they apply', async () => {
    const first = open('#/calculator?kind=building&subject=409000&from=28&to=30');
    await screen.findByRole('table');
    expect(screen.getByLabelText('Speed bonus %')).toBeTruthy();
    expect(screen.getByLabelText('Cost reduction %')).toBeTruthy();
    first.unmount();

    open('#/calculator?kind=chip&subject=4&to=1');
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Speed bonus %')).toBeNull();
    expect(screen.queryByLabelText('Cost reduction %')).toBeNull();
    // A chip range converts its EXP to cards from data.
    expect(screen.getByText('60K EXP = 1 × Big card (60,000 each)')).toBeTruthy();
  });

  it('offers the link and nothing that sends the range to the archived planner', async () => {
    open('#/calculator?kind=building&subject=409000&from=28&to=30');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load into my plan' })).toBeNull();
  });

  it('asks for a subject before it shows anything', async () => {
    open('#/calculator');
    expect(await screen.findByText('Pick what to price.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a link to one vehicle part as the entry that stands for all six', async () => {
    open('#/calculator?kind=vehicle_part&subject=4&from=10&to=12');
    await screen.findByRole('table');
    expect(mocks.loadSteps).toHaveBeenCalledWith([
      { kind: 'vehicle_part', subject: '1', from: 10, to: 12 },
    ]);
    expect(screen.getByText('Every vehicle part costs the same.')).toBeTruthy();
  });

  it('offers research a main tree at a time, opening on the linked research tree', async () => {
    open('#/calculator?kind=research&subject=7001&to=2');
    await screen.findByRole('table');
    // The Select is a button until opened: it reads the chosen tree, and the
    // count beside it is the tree's own research, not the catalogue's three.
    expect((await screen.findByLabelText('Tree')).textContent).toBe('Battle (1)');
    expect(screen.getByLabelText('Subject').textContent).toBe('Marching Speed');
  });

  it('has no tree to pick for a kind that is not research', async () => {
    open('#/calculator?kind=building&subject=409000&from=28&to=30');
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Tree')).toBeNull();
  });

  it('opens a season building under the season entry', async () => {
    open('#/calculator?kind=building&subject=868000&to=2');
    await screen.findByRole('table');
    expect(screen.getByLabelText('Season')).toBeTruthy();
  });

  it('prices what the range needs first when the link asks for it', async () => {
    mocks.loadSteps.mockResolvedValue({
      steps: [
        {
          ...step('building', '401000', 29),
          step: { ...step('building', '401000', 29).step, name: 'Wall' },
          prerequisite: true,
        },
        step('building', '409000', 29),
        step('building', '409000', 30),
      ],
      gaps: [],
    });
    open('#/calculator?kind=building&subject=409000&from=28&to=30&pre=1');

    const [needed, own] = await screen.findAllByRole('table');
    expect(mocks.loadSteps).toHaveBeenCalledWith(
      [{ kind: 'building', subject: '409000', from: 28, to: 30 }],
      true,
    );
    // No book in this answer, so the row is read-only: there is nothing to plan again from.
    expect(within(needed as HTMLElement).getByText('Wall · 28 → 29')).toBeTruthy();
    expect(within(own as HTMLElement).getByText('This range alone')).toBeTruthy();
    // Three steps of 300K each at the top; two of them the range's own.
    const totals = screen.getByRole('group', { name: 'Totals' });
    expect(within(totals).getByText('900K')).toBeTruthy();
    expect(within(own as HTMLElement).getByText('600K')).toBeTruthy();
    expect(
      screen.getByText(/Includes 1 needed first, each from where Bank 28 already had it/),
    ).toBeTruthy();
    expect(screen.queryByText(/not included/)).toBeNull();
    expect((screen.getByLabelText('Include what it needs first') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('offers the switch for buildings and research only, with the way to the planner', async () => {
    const first = open('#/calculator?kind=building&subject=409000&from=28&to=30');
    await screen.findByRole('table');
    expect((screen.getByLabelText('Include what it needs first') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByRole('link', { name: 'planner' }).getAttribute('href')).toBe('#/planner');
    first.unmount();

    open('#/calculator?kind=chip&subject=4&to=1&pre=1');
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Include what it needs first')).toBeNull();
    expect(mocks.loadSteps).toHaveBeenLastCalledWith([
      { kind: 'chip', subject: '4', from: 0, to: 1 },
    ]);
  });
});
