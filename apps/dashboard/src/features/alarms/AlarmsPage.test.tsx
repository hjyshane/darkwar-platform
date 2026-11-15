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
  inputs: {} as Record<string, unknown[]>,
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
  const record = (name: string, input: unknown) => {
    mock.calls.push(name);
    mock.inputs[name] = [...(mock.inputs[name] ?? []), input];
  };
  const mutation = (name: string) => () => ({
    mutate: (input: unknown) => record(name, input),
    mutateAsync: async (input: unknown) => record(name, input),
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
    useSavePingRole: mutation('ping'),
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
  mock.inputs = {};
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

  test('an officer sends now from an untouched panel without rewriting the message', async () => {
    mock.role = 'officer';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Alarms and message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    // The cached message may be older than another officer's: not written back.
    await waitFor(() => expect(mock.calls).toEqual(['send']));
  });

  test('an officer who edited the message saves it before sending now', async () => {
    mock.role = 'officer';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Alarms and message/ }));
    fireEvent.change(screen.getByLabelText("Message on this entry's alarms"), {
      target: { value: 'Rally at the gate {in}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(mock.calls).toEqual(['save', 'send']));
    expect(mock.inputs.save?.[0]).toMatchObject({ message: 'Rally at the gate {in}' });
  });

  test('"use for every board" sets only the ping role on the other boards, in one call', async () => {
    mock.role = 'officer';
    mock.boards = [
      board({}),
      board({ category: 'game_bio_mutant', label: 'Frankie', messageTemplate: 'Theirs' }),
      board({ category: 'server_clash', label: 'Server Clash', channel: 'general' }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Zombie Siege' }));
    fireEvent.change(screen.getByLabelText('Ping role ID (optional)'), {
      target: { value: '123456789012345678' },
    });
    fireEvent.click(screen.getByLabelText('Use for every board'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mock.calls).toEqual(['save-board', 'ping']));
    // The whole-board save touched this board only; the others got the role alone.
    expect(mock.inputs['save-board']).toHaveLength(1);
    expect(mock.inputs['save-board']?.[0]).toMatchObject({ category: 'game_zombie_siege' });
    expect(mock.inputs.ping).toEqual([
      { pingRoleId: '123456789012345678', categories: ['game_bio_mutant', 'server_clash'] },
    ]);
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
