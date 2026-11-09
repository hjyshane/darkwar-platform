import { describe, expect, it } from 'vitest';
import type { BoardRow } from './composition';
import type { HistoryRow } from './deltaWindow';
import { type HeaderInputs, type HeaderPlayer, buildHeaderModel } from './headerModel';
import type { PlayerArenaEntry } from './playerArena';
import type { PlayerLocation } from './playerLocation';

const now = new Date('2026-11-08T12:00:00Z');

const nobody: HeaderPlayer = {
  serverId: 580,
  hqLevel: null,
  power: null,
  kills: null,
  isOwnAlliance: false,
  onlineState: null,
  offlineSince: null,
  observedAt: null,
  powerAt: null,
};

const minimal: HeaderInputs = {
  player: nobody,
  rank: null,
  location: null,
  boardRows: [],
  history: [],
  firstSeenInAlliance: null,
  arena: [],
  now,
};

const build = (over: Partial<HeaderInputs> = {}, player: Partial<HeaderPlayer> = {}) =>
  buildHeaderModel({ ...minimal, ...over, player: { ...nobody, ...player } });

const place = (over: Partial<PlayerLocation> = {}): PlayerLocation => ({
  x: 491,
  y: 444,
  serverId: 580,
  capturedAt: '2026-11-08T10:00:00Z',
  shieldEndAt: null,
  ...over,
});

const led = (model: ReturnType<typeof build>, key: string) =>
  model.leds.find((item) => item.key === key);

const power = (day: string, value: number): HistoryRow => ({
  captured_at: `${day}T02:05:00Z`,
  power: value,
  kills: null,
  source_command: 'server.rank',
});
const kills = (day: string, value: number): HistoryRow => ({
  captured_at: `${day}T02:05:00Z`,
  power: null,
  kills: value,
  source_command: 'kill.rank',
});
const board = (metric: string, value: number, rank: number | null = null): BoardRow => ({
  metric,
  power: value,
  rank,
  captured_at: '2026-11-08T02:10:00Z',
});

describe('buildHeaderModel — minimal data', () => {
  it('shows dashes and neutral lights, and leaves the optional sections empty', () => {
    const model = build();
    expect(model.leds.map((item) => [item.key, item.tone, item.text])).toEqual([
      ['shield', 'neutral', 'NO MAP READ'],
      ['online', 'neutral', 'PRESENCE UNKNOWN'],
      ['data', 'neutral', 'NO POWER READ'],
    ]);
    expect(model.verdict).toEqual([]);
    expect(model.ticks).toEqual([]);
    expect(model.boardsAsOf).toBeNull();
    expect(model.lineups).toEqual([]);
    for (const cell of [model.power, model.rank, model.position, model.kills, model.sixth]) {
      expect(cell.value).toBeNull();
    }
    expect(model.lastSeen.value).toBe('—');
    expect(model.position.context).toBe('not scanned');
    expect(model.sixth.label).toBe('HQ');
  });
});

describe('buildHeaderModel — shield light', () => {
  it('is green with the time left while the shield is up', () => {
    const up = (shieldEndAt: string) => led(build({ location: place({ shieldEndAt }) }), 'shield');
    expect(up('2026-11-08T17:30:00Z')).toMatchObject({ tone: 'ok', text: 'SHIELD 5h' });
    expect(up('2026-11-08T12:45:00Z')).toMatchObject({ tone: 'ok', text: 'SHIELD 45m' });
    expect(up('2026-11-11T13:00:00Z')).toMatchObject({ tone: 'ok', text: 'SHIELD 3d' });
  });
  it('is red with the time since it ended when it is down', () => {
    const down = (shieldEndAt: string | null) =>
      led(build({ location: place({ shieldEndAt }) }), 'shield');
    expect(down('2026-11-01T11:00:00Z')).toMatchObject({ tone: 'bad', text: 'SHIELD OFF 7d' });
    expect(down('2026-11-08T07:00:00Z')).toMatchObject({ tone: 'bad', text: 'SHIELD OFF 5h' });
    expect(down(null)).toMatchObject({ tone: 'bad', text: 'SHIELD OFF' });
  });
  it('is neutral when the newest map read is older than seven days', () => {
    const old = build({
      location: place({ capturedAt: '2026-10-30T10:00:00Z', shieldEndAt: '2026-10-29T10:00:00Z' }),
    });
    expect(led(old, 'shield')).toMatchObject({ tone: 'neutral', text: 'NO MAP READ' });
  });
  it('says the reading can be out of date', () => {
    const model = build({ location: place() });
    expect(led(model, 'shield')?.title).toContain('2h ago');
  });
});

describe('buildHeaderModel — presence and data lights', () => {
  it('reads presence as online, seen, offline or unknown', () => {
    expect(led(build({}, { onlineState: 'online' }), 'online')).toMatchObject({
      tone: 'ok',
      text: 'ONLINE',
    });
    expect(
      led(build({}, { onlineState: 'offline', offlineSince: '2026-11-08T09:00:00Z' }), 'online'),
    ).toMatchObject({ tone: 'neutral', text: 'SEEN 3h ago' });
    expect(led(build({}, { onlineState: 'offline' }), 'online')).toMatchObject({
      tone: 'neutral',
      text: 'OFFLINE',
    });
  });
  it('warns when the newest power reading is older than 48 hours', () => {
    expect(led(build({}, { powerAt: '2026-11-08T07:00:00Z' }), 'data')).toMatchObject({
      tone: 'ok',
      text: 'DATA 5h ago',
    });
    expect(led(build({}, { powerAt: '2026-11-05T11:00:00Z' }), 'data')).toMatchObject({
      tone: 'warn',
      text: 'DATA 3d ago',
    });
  });
});

describe('buildHeaderModel — cells', () => {
  const history = [power('2026-10-10', 940_600_000), power('2026-11-08', 1_000_000_000)];

  it('writes the window out: 30d for our own members', () => {
    const model = build({ history }, { power: 1_000_000_000, isOwnAlliance: true });
    expect(model.power).toMatchObject({
      label: 'Power',
      value: '1,000,000,000',
      context: '+59.4M · 30d',
      tone: 'up',
    });
  });
  it('writes the window out: 7d for everyone else, and a loss reads down', () => {
    const model = build(
      { history: [power('2026-11-02', 101_200_000), power('2026-11-08', 100_000_000)] },
      { power: 100_000_000 },
    );
    expect(model.power).toMatchObject({ context: '-1.2M · 7d', tone: 'down' });
  });
  it('a flat window is zero with no direction', () => {
    const model = build({ history: [power('2026-11-02', 5), power('2026-11-08', 5)] });
    expect(model.power).toMatchObject({ context: '0 · 7d', tone: 'neutral' });
  });
  it('says "as of" with one reading, or with none but a known reading time', () => {
    expect(build({ history: [power('2026-11-08', 5)] }).power.context).toBe('as of 2026-11-08');
    expect(build({}, { powerAt: '2026-11-03T02:05:00Z' }).power.context).toBe('as of 2026-11-03');
    expect(build().power.context).toBeUndefined();
  });
  it('reads kills from the kill board only', () => {
    const model = build(
      { history: [kills('2026-11-02', 100), power('2026-11-05', 9), kills('2026-11-08', 130)] },
      { kills: 130 },
    );
    expect(model.kills).toMatchObject({ value: '130', context: '+30 · 7d', tone: 'up' });
    expect(build({}, { kills: 130 }).kills.context).toBeUndefined();
  });

  it('gives a mid rank the gap to the place above', () => {
    const model = build({
      rank: { rank: 12, total: 900, gapToAbove: 1_200_000, leadOverBelow: 3_000_000 },
    });
    expect(model.rank).toMatchObject({
      label: 'Server rank',
      value: '#12',
      unit: '/900',
      context: '1.2M to #11',
    });
  });
  it('gives rank 1 the lead over the runner-up', () => {
    const model = build({
      rank: { rank: 1, total: 900, gapToAbove: null, leadOverBelow: 59_400_000 },
    });
    expect(model.rank).toMatchObject({ value: '#1', context: '59.4M over #2' });
  });

  it('shows a known position with its server', () => {
    expect(build({ location: place() }).position).toMatchObject({
      label: 'Location',
      value: '491, 444',
      context: 'server 580',
      serverId: 580,
      stale: false,
    });
  });
  it('dates a position older than a day instead of presenting it as current', () => {
    const model = build({ location: place({ capturedAt: '2026-11-05T12:00:00Z' }) });
    expect(model.position).toMatchObject({
      value: '491, 444',
      context: 'server 580 · 3d ago',
      stale: true,
    });
  });

  it('shows last seen with when presence was read', () => {
    const model = build(
      {},
      {
        onlineState: 'offline',
        offlineSince: '2026-11-08T09:00:00Z',
        observedAt: '2026-11-08T11:00:00Z',
      },
    );
    expect(model.lastSeen).toMatchObject({
      label: 'Last Online',
      value: '3h ago',
      context: 'read 1h ago',
    });
  });

  it('shows tenure when the roster is readable, else HQ level', () => {
    expect(build({ firstSeenInAlliance: '2026-09-24T12:00:00Z' }, { hqLevel: 30 }).sixth).toEqual({
      label: 'In alliance',
      value: '45d',
      context: 'since 2026-09-24',
    });
    expect(build({}, { hqLevel: 30 }).sixth).toEqual({ label: 'HQ', value: '30' });
  });
});

describe('buildHeaderModel — composition', () => {
  const six = [
    board('hero_power_total', 70_857_050, 3),
    board('pet_power_total', 7_977_471, 1),
    board('science_power', 40_000_000),
    board('mod_car_power', 20_000_000),
    board('army_power', 150_000_000),
    board('building_power', 56_114_096),
  ];
  const total = 344_948_617;

  it('draws one tick per board, by value, with rank only where the game ranks', () => {
    const model = build({ boardRows: six }, { power: total });
    expect(model.ticks.map((tick) => tick.label)).toEqual([
      'troops',
      'heroes',
      'buildings',
      'tech',
      'vehicle',
      'pets',
    ]);
    expect(model.ticks.map((tick) => tick.rank)).toEqual([
      undefined,
      3,
      undefined,
      undefined,
      undefined,
      1,
    ]);
    expect(model.ticks[1]?.value).toBe('70.86M');
    expect(model.ticks[0]?.share).toBeUndefined();
    expect(model.ticks[1]?.share).toBeCloseTo(70_857_050 / (total - 150_000_000));
    expect(model.boardsAsOf).toBe('2026-11-08');
  });
  it('omits shares when the boards do not add up to the total', () => {
    const model = build({ boardRows: six.slice(0, 2) }, { power: total });
    expect(model.ticks.every((tick) => tick.share === undefined)).toBe(true);
  });
});

describe('buildHeaderModel — verdict and lineups', () => {
  it('composes rank, shield and boards into one sentence', () => {
    const model = build({
      rank: { rank: 12, total: 900, gapToAbove: 1_200_000, leadOverBelow: 3_000_000 },
      location: place({ shieldEndAt: '2026-11-05T22:00:00Z' }),
      boardRows: [board('hero_power_total', 10, 2), board('pet_power_total', 5, 1)],
    });
    expect(model.verdict.map((segment) => segment.text).join('')).toBe(
      '#12 on 580, 1.2M behind #11. Shield off since 2026-11-05. Pets #1; heroes #2.',
    );
  });
  it('keeps at most three arena rows', () => {
    const entry = (league: number): PlayerArenaEntry => ({
      entryId: `e-${league}`,
      league,
      weekStart: '2026-11-02',
      capturedAt: '2026-11-08T03:00:00Z',
      rank: 7,
      score: null,
      defensePower: null,
      lineup: [],
    });
    expect(build({ arena: [4, 3, 2, 1].map(entry) }).lineups).toHaveLength(3);
  });
});
