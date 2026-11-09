import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineupHero } from '../../lib/troops';
import { ProfileHeader, type ProfileHeaderProps } from './ProfileHeader';
import { type HeaderInputs, buildHeaderModel } from './headerModel';
import type { PlayerArenaEntry } from './playerArena';

// The lineup table brings the hero catalogue and the icon store with it; the
// header only has to place it.
vi.mock('../arena/LineupCell', () => ({
  LineupCell: ({ heroes }: { heroes: readonly unknown[] }) => (
    <div data-testid="lineup">{heroes.length} heroes</div>
  ),
}));

afterEach(cleanup);

const now = new Date('2026-11-08T12:00:00Z');

const minimalInputs: HeaderInputs = {
  player: {
    serverId: 580,
    hqLevel: null,
    power: null,
    kills: null,
    isOwnAlliance: false,
    onlineState: null,
    offlineSince: null,
    observedAt: null,
    powerAt: null,
  },
  rank: null,
  location: null,
  boardRows: [],
  history: [],
  firstSeenInAlliance: null,
  arena: [],
  now,
};

const entry = (league: number, lineup: LineupHero[]): PlayerArenaEntry => ({
  entryId: `e-${league}`,
  league,
  weekStart: '2026-11-02',
  capturedAt: '2026-11-08T03:00:00Z',
  rank: 7,
  score: 1200,
  defensePower: 12_300_000,
  lineup,
});

const board = (metric: string, power: number, rank: number | null = null) => ({
  metric,
  power,
  rank,
  captured_at: '2026-11-08T02:10:00Z',
});

const fullInputs: HeaderInputs = {
  player: {
    serverId: 580,
    hqLevel: 30,
    power: 344_948_617,
    kills: 1_250_000,
    isOwnAlliance: true,
    onlineState: 'offline',
    offlineSince: '2026-11-08T09:00:00Z',
    observedAt: '2026-11-08T11:00:00Z',
    powerAt: '2026-11-08T02:05:00Z',
  },
  rank: { rank: 12, total: 900, gapToAbove: 1_200_000, leadOverBelow: 3_000_000 },
  location: {
    x: 491,
    y: 444,
    serverId: 580,
    capturedAt: '2026-11-08T10:00:00Z',
    shieldEndAt: '2026-11-05T22:00:00Z',
  },
  boardRows: [
    board('hero_power_total', 70_857_050, 3),
    board('pet_power_total', 7_977_471, 1),
    board('science_power', 40_000_000),
    board('mod_car_power', 20_000_000),
    board('army_power', 150_000_000),
    board('building_power', 56_114_096),
  ],
  history: [
    {
      captured_at: '2026-10-10T02:05:00Z',
      power: 285_548_617,
      kills: null,
      source_command: 'server.rank',
    },
    {
      captured_at: '2026-11-08T02:05:00Z',
      power: 344_948_617,
      kills: null,
      source_command: 'server.rank',
    },
  ],
  firstSeenInAlliance: '2026-09-24T12:00:00Z',
  arena: [
    entry(1, [{} as LineupHero, {} as LineupHero]),
    entry(2, []),
    entry(3, [{} as LineupHero]),
    entry(4, [{} as LineupHero]),
  ],
  now,
};

const base: Omit<ProfileHeaderProps, 'model'> = {
  name: 'Shane',
  gameUid: 58000001,
  serverId: 580,
  alliance: null,
  hqLevel: null,
  lastSeenAt: null,
  now,
};

describe('ProfileHeader — minimal data', () => {
  it('renders the name, three lights and six cells of dashes, and nothing it has no data for', () => {
    const { container } = render(
      <ProfileHeader {...base} model={buildHeaderModel(minimalInputs)} />,
    );
    const section = container.querySelector('section.entity.profile-header');
    expect(section?.getAttribute('aria-labelledby')).toBe('player-heading');
    expect(container.querySelector('h2#player-heading')?.textContent).toBe('Shane');
    expect(container.querySelectorAll('.profile-leds .led')).toHaveLength(3);
    const cells = container.querySelectorAll('.profile-cells .cell');
    expect(cells).toHaveLength(6);
    expect(cells[0]?.hasAttribute('data-hero')).toBe(true);
    expect([...cells].map((cell) => cell.querySelector('.cell-value')?.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(container.querySelector('p.verdict')).toBeNull();
    expect(container.querySelector('ul.ticks')).toBeNull();
    expect(container.querySelector('.profile-lineup')).toBeNull();
    expect(container.querySelector('a[href^="#/map"]')).toBeNull();
    expect(container.querySelector('.entity-foot')?.textContent).toContain('UID 58000001');
  });
});

describe('ProfileHeader — full data', () => {
  const model = buildHeaderModel(fullInputs);
  const full: ProfileHeaderProps = {
    ...base,
    alliance: { id: 'a-1', code: 'CBFW', name: 'Crossbow' },
    hqLevel: 30,
    lastSeenAt: '2026-11-08T02:05:00Z',
    model,
  };

  it('puts the identity, the alliance link and the lights in the first row', () => {
    const { container } = render(<ProfileHeader {...full} favourite={<i data-testid="fav" />} />);
    expect(container.querySelector('h2 [data-testid="fav"]')).not.toBeNull();
    const meta = container.querySelector('.entity-meta');
    expect(meta?.querySelector('a[href="#/server/580"]')?.textContent).toBe('Server 580');
    expect(meta?.textContent).toContain('[CBFW] Crossbow');
    expect(meta?.textContent).toContain('HQ 30');
    expect(
      [...container.querySelectorAll('.profile-leds .led')].map((led) => led.textContent),
    ).toEqual(['SHIELD OFF 2d', 'SEEN 3h ago', 'DATA 9h ago']);
  });

  it('sets the verdict figures in code', () => {
    const { container } = render(<ProfileHeader {...full} />);
    const verdict = container.querySelector('p.verdict');
    expect(verdict?.textContent).toBe(
      '#12 on 580, 1.2M behind #11. Shield off since 2026-11-05. Pets #1; heroes #3.',
    );
    expect([...(verdict?.querySelectorAll('code') ?? [])].map((code) => code.textContent)).toEqual([
      '#12',
      '580',
      '1.2M',
      '#11',
      '2026-11-05',
      '#1',
      '#3',
    ]);
  });

  it('fills the six cells with their context lines', () => {
    const { container } = render(<ProfileHeader {...full} />);
    const cells = [...container.querySelectorAll('.profile-cells .cell')];
    expect(cells.map((cell) => cell.querySelector('.cell-label')?.textContent)).toEqual([
      'Power',
      'Server rank',
      'Location',
      'Kills',
      'Last Online',
      'In alliance',
    ]);
    expect(cells[0]?.querySelector('.cell-value')?.textContent).toBe('344,948,617');
    expect(cells[0]?.querySelector('.cell-context')?.textContent).toBe('+59.4M · 30d');
    expect(cells[0]?.getAttribute('data-tone')).toBe('up');
    expect(cells[1]?.querySelector('.cell-value')?.textContent).toBe('#12/900');
    expect(cells[5]?.querySelector('.cell-value')?.textContent).toBe('45d');
  });

  it('links the position to the server map and keeps the coordinate as the map toggle', () => {
    const onToggleMap = vi.fn();
    const { container } = render(
      <ProfileHeader
        {...full}
        mapOpen={false}
        mapSlot={<div data-testid="map" />}
        onToggleMap={onToggleMap}
      />,
    );
    const position = container.querySelectorAll('.profile-cells .cell')[2];
    expect(position?.querySelector('a[href="#/map/580"]')?.textContent).toBe('server 580');
    const toggle = position?.querySelector('button.linklike');
    expect(toggle?.textContent).toBe('491, 444');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle as Element);
    expect(onToggleMap).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.profile-map [data-testid="map"]')).not.toBeNull();
  });

  it('draws the composition as ticks, dated', () => {
    const { container } = render(<ProfileHeader {...full} />);
    const ticks = container.querySelector('ul.ticks');
    expect(ticks?.getAttribute('aria-label')).toBe('Power composition');
    expect(ticks?.querySelectorAll('li.tick')).toHaveLength(6);
    expect(container.querySelector('.profile-composition .profile-label')?.textContent).toBe(
      'Power composition · as of 2026-11-08',
    );
  });

  it('summarises at most three arena lineups and links to the rest', () => {
    const onShowArena = vi.fn();
    const { container, getByRole } = render(<ProfileHeader {...full} onShowArena={onShowArena} />);
    const rows = [...container.querySelectorAll('.profile-lineup')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Gold');
    expect(rows[0]?.textContent).toContain('Seen in arena · 2026-11-08');
    expect(rows[0]?.textContent).toContain('12.3M');
    expect(rows[0]?.querySelector('[data-testid="lineup"]')?.textContent).toBe('2 heroes');
    // An entry with no `army` is not an empty defence.
    expect(rows[1]?.querySelector('[data-testid="lineup"]')).toBeNull();
    expect(rows[1]?.textContent).toContain('No lineup was captured');
    fireEvent.click(getByRole('button', { name: 'All arena entries' }));
    expect(onShowArena).toHaveBeenCalledTimes(1);
  });
});
