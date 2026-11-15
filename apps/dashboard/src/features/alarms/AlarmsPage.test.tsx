// The Alarms tab with its queries mocked: what a member reads, what an officer
// can do, and the warnings only an officer is shown.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AlarmsPage } from './AlarmsPage';
import type { AlarmBoard, AlarmEntry, Delivery } from './alarmLogic';

const MIN = 60_000;
const HOUR = 60 * MIN;

const mock = vi.hoisted(() => ({
  role: 'member',
  entries: [] as unknown[],
  boards: [] as unknown[],
  deliveries: {} as Record<string, unknown[]>,
  channels: [] as string[],
  routing: null as unknown,
  picks: [] as unknown[],
  calls: [] as string[],
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/useSession', () => ({
  useSession: () => ({ data: { role: mock.role, email: null, userId: 'u-1', playerId: null } }),
}));
vi.mock('../../lib/permissions', async (original) => ({
  ...(await original<typeof import('../../lib/permissions')>()),
  usePermissions: () => ({
    data: {
      capabilities: [],
      grants: [
        { role: 'officer', capability: 'schedule.manage', allowed: true },
        { role: 'member', capability: 'schedule.view', allowed: true },
      ],
    },
  }),
}));
vi.mock('../../lib/channels', () => ({ useChannelNames: () => ({ data: mock.channels }) }));
vi.mock('../../lib/useMyAlliances', () => ({
  useActiveAlliance: () => ({ active: null, alliances: [], switchTo: () => undefined }),
}));
vi.mock('./alarms', () => {
  const mutation = (name: string) => () => ({
    mutate: () => mock.calls.push(name),
    mutateAsync: async () => {
      mock.calls.push(name);
    },
    isPending: false,
    error: null,
    reset: () => undefined,
  });
  return {
    useAlarmEntries: () => ({ data: mock.entries, isPending: false, error: null }),
    useAlarmBoards: () => ({ data: mock.boards, isPending: false, error: null }),
    useAlarmDeliveries: () => ({ data: mock.deliveries }),
    useGameEventsForServer: () => ({ data: [] }),
    useReminderRouting: () => ({ data: mock.routing }),
    useUnplacedPicks: () => ({ data: mock.picks }),
    useSaveEntryAlarms: mutation('save'),
    useSendOnce: mutation('send'),
    useHideEntry: mutation('hide'),
    useSaveBoard: mutation('save-board'),
    useWatchGameEvent: mutation('watch'),
    useAddEntry: mutation('add'),
    useEditEntry: mutation('edit'),
  };
});

const iso = (ms: number) => new Date(ms).toISOString();

function board(patch: Partial<AlarmBoard>): AlarmBoard {
  return {
    category: 'game_zombie_siege',
    label: 'Zombie Siege',
    kind: 'point',
    channel: null,
    pingRoleId: null,
    startReminders: [720, 60, 5],
    closeReminders: [720, 60, 5],
    alarmOnOpen: true,
    messageTemplate: null,
    activityId: null,
    activityStage: 'main',
    sortOrder: 10,
    ...patch,
  };
}

const step = (minutesBefore: number) => ({
  reminderId: `r-${minutesBefore}`,
  anchor: 'start' as const,
  minutesBefore,
  sendAt: null,
  enabled: true,
});

/** Three hours out: the 12 h alarm went out nine hours ago, 1 h and 5 m are ahead. */
function siege(): AlarmEntry {
  return {
    id: 'ev-siege',
    title: 'Zombie Siege',
    category: 'game_zombie_siege',
    startsAt: iso(Date.now() + 3 * HOUR),
    endsAt: null,
    source: 'captured',
    sourceKey: 'pick:siege:1',
    alarmMessage: 'Shields up before {start}',
    steps: [step(720), step(60), step(5)],
  };
}

function sent(entry: AlarmEntry): Delivery {
  return {
    alarmStep: 'start:720',
    anchorAt: entry.startsAt,
    deliveredAt: iso(Date.now() - 9 * HOUR),
    expiredAt: null,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AlarmsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const entry = siege();
  mock.role = 'member';
  mock.entries = [entry];
  mock.boards = [board({})];
  mock.deliveries = { [entry.id]: [sent(entry)] };
  mock.channels = ['general'];
  mock.routing = { enabled: true, channel: 'general' };
  mock.picks = [];
  mock.calls = [];
});

afterEach(cleanup);

describe('AlarmsPage', () => {
  test('a member reads each alarm and cannot send or change anything', () => {
    renderPage();
    expect(screen.getByText('Zombie Siege', { selector: '.alarm-title' })).toBeTruthy();
    expect(screen.getByText('12h ✓ sent')).toBeTruthy();
    expect(screen.getByText('1h · pending')).toBeTruthy();
    expect(screen.getByText('5m · pending')).toBeTruthy();
    expect(screen.getByText('alliance pick')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Alarms and message/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add an entry' })).toBeNull();
    expect(screen.queryByText(/Nothing will be sent/)).toBeNull();
  });

  test('an officer opens an entry and sends now, saving the message first', async () => {
    mock.role = 'officer';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Alarms and message/ }));
    const send = screen.getByRole('button', { name: 'Send now' });
    fireEvent.click(send);
    await waitFor(() => expect(mock.calls).toEqual(['save', 'send']));
  });

  test('an officer is told a board on a switched-off channel sends nothing', () => {
    mock.role = 'officer';
    mock.boards = [board({ channel: 'alarm' })];
    renderPage();
    const boards = screen.getByRole('region', { name: 'Boards' });
    expect(within(boards).getByText(/Nothing will be sent/)).toBeTruthy();
  });

  test('picks the game could not place are listed', () => {
    mock.role = 'officer';
    mock.picks = [
      {
        id: 'p-1',
        eventKey: 'zombie_siege',
        slot: 1,
        startsAt: iso(Date.now() + 5 * HOUR),
        endsAt: null,
        capturedAt: iso(Date.now() - HOUR),
        serverId: 581,
      },
    ];
    renderPage();
    expect(
      screen.getByText('Picks the game reported that could not be tied to an alliance'),
    ).toBeTruthy();
    expect(screen.getByText(/zombie siege, slot 1/)).toBeTruthy();
  });
});
