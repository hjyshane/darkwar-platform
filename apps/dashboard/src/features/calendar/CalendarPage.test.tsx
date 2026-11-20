// The calendar with its two reads mocked: an event nobody has identified is
// kept off the calendar and listed apart, and an event opens a card with the
// game's own text.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';
import type { CalendarEvent, EventText } from './data';

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const mock = vi.hoisted(() => ({
  role: 'member',
  events: [] as unknown[],
  text: { summary: null, rules: null } as { summary: string | null; rules: string | null },
  asked: [] as string[],
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/useSession', () => ({
  useSession: () => ({ data: { role: mock.role, email: null, userId: 'u-1', playerId: null } }),
}));
vi.mock('./data', async (original) => ({
  ...(await original<typeof import('./data')>()),
  fetchCalendar: async () => mock.events,
  fetchEventText: async (id: string): Promise<EventText> => {
    mock.asked.push(id);
    return mock.text;
  },
}));

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  server_id: 580,
  activity_id: '41101',
  name: 'Arctic Ice Pit',
  category: 'season',
  activity_type: 126,
  starts_at: at(-24),
  ends_at: at(24),
  need_hq_level: 10,
  sub_type: null,
  seen_at: at(-1),
  ...over,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.role = 'member';
  mock.asked = [];
  mock.text = { summary: null, rules: null };
  mock.events = [
    event({}),
    event({ activity_id: '40401', name: null, category: null, activity_type: null }),
  ];
});
afterEach(cleanup);

describe('an event nobody has identified', () => {
  test('is not drawn on the calendar', async () => {
    show();

    const week = await screen.findByRole('region', { name: 'Week' });
    expect(within(week).getByRole('button', { name: /Arctic Ice Pit/ })).toBeTruthy();
    expect(within(week).queryByText(/40401/)).toBeNull();
  });

  test('is listed apart, by its id', async () => {
    show();

    const heading = await screen.findByRole('heading', { name: /Unidentified \(1\)/ });
    const panel = heading.closest('details');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole('button', { name: 'Event #40401' })).toBeTruthy();
  });

  test('does not count as running in the figures at the top', async () => {
    show();

    await screen.findByRole('region', { name: 'Week' });
    // The strip names the event that ends next; with one identified event
    // running it can only be that one, never "Event #40401".
    expect(screen.queryAllByText('Event #40401')).toHaveLength(1);
  });

  test('opens a card that says the game has no entry for it, and asks for no text', async () => {
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Event #40401' }));

    const card = screen.getByRole('dialog', { hidden: true });
    expect(within(card).getByText('Unidentified')).toBeTruthy();
    expect(within(card).getByText(/game client's event table has no entry/)).toBeTruthy();
    expect(mock.asked).toEqual([]);
  });

  test('offers the naming form to an officer, not to a member', async () => {
    mock.role = 'officer';
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Event #40401' }));

    const card = screen.getByRole('dialog', { hidden: true });
    expect(within(card).getByRole('button', { name: 'Edit Event #40401' })).toBeTruthy();
  });

  test('with none, there is no Unidentified section', async () => {
    mock.events = [event({})];
    show();

    await screen.findByRole('region', { name: 'Week' });
    expect(screen.queryByRole('heading', { name: /Unidentified/ })).toBeNull();
  });
});

describe('the card an event opens', () => {
  test("shows the game's summary and rules for the event clicked", async () => {
    mock.text = { summary: 'Beat Tundra Titan!', rules: 'Conquest Rules:\n1. The ice thaws.' };
    show();

    const week = await screen.findByRole('region', { name: 'Week' });
    fireEvent.click(within(week).getByRole('button', { name: /Arctic Ice Pit/ }));

    const card = screen.getByRole('dialog', { hidden: true });
    expect(await within(card).findByText('Beat Tundra Titan!')).toBeTruthy();
    expect(within(card).getByText(/Conquest Rules:/)).toBeTruthy();
    expect(within(card).getByText(/Running · ends in/)).toBeTruthy();
    expect(within(card).getByText('10+')).toBeTruthy();
    expect(mock.asked).toEqual(['41101']);
  });

  test('says so when the game has no description', async () => {
    show();

    const week = await screen.findByRole('region', { name: 'Week' });
    fireEvent.click(within(week).getByRole('button', { name: /Arctic Ice Pit/ }));

    const card = screen.getByRole('dialog', { hidden: true });
    expect(
      await within(card).findByText('The game has no description for this event.'),
    ).toBeTruthy();
  });

  test('closes', async () => {
    show();

    const week = await screen.findByRole('region', { name: 'Week' });
    fireEvent.click(within(week).getByRole('button', { name: /Arctic Ice Pit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
