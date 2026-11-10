import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MOVES_PAGE_SIZE,
  MovesFeed,
  MovesTable,
  RecentMovesView,
  movesEmptyText,
} from './AllianceMoves';
import type { AllianceMove } from './moves';

afterEach(cleanup);

const NOW = new Date('2026-11-09T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const OTHER = '00000000-0000-4000-8000-0000000000c1';

// The generated row type says these are never null; at runtime the other side
// is null for "no alliance" and for an alliance we have not catalogued.
function move(
  n: number,
  direction: string,
  other: { id: string | null; tag: string | null; server: number | null },
  hours = n,
): AllianceMove {
  return {
    player_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    game_uid: 9_700_000_000_000_000 + n,
    player_name: `Player${n}`,
    direction,
    other_alliance_id: other.id,
    other_alliance_tag: other.tag,
    other_alliance_name: other.tag === null ? null : 'Other',
    other_server_id: other.server,
    power_at: 100_000_000 + n,
    observed_at: hoursAgo(hours),
  } as unknown as AllianceMove;
}

const ROWS = [
  move(1, 'in', { id: OTHER, tag: 'CLaw', server: 571 }),
  move(2, 'out', { id: null, tag: null, server: 571 }),
  move(3, 'in', { id: null, tag: null, server: null }),
  move(4, 'relocated', { id: OTHER, tag: 'CBFW', server: 579 }),
];

function bodyRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  );
}

describe('MovesTable', () => {
  it('reads each move: who, which way, the other side, power then, when', () => {
    const { container } = render(<MovesTable now={NOW} rows={ROWS} />);
    expect(bodyRows(container)).toEqual([
      ['Player1', 'In', '[CLaw] on 571', '100M', '1h ago'],
      ['Player2', 'Out', 'on 571', '100M', '2h ago'],
      ['Player3', 'In', 'no alliance', '100M', '3h ago'],
      ['Player4', 'Relocated', '[CBFW] on 579', '100M', '4h ago'],
    ]);
  });

  it('lights the direction and links the player and a catalogued alliance', () => {
    const { container } = render(<MovesTable now={NOW} rows={ROWS} />);
    expect(
      [...container.querySelectorAll('.led')].map((led) => led.getAttribute('data-tone')),
    ).toEqual(['ok', 'bad', 'ok', 'neutral']);
    const first = container.querySelector('tbody tr');
    expect(first?.querySelector('td a')?.getAttribute('href')).toBe(
      '#/player/00000000-0000-4000-8000-000000000001',
    );
    expect(
      [...container.querySelectorAll('tbody a')].filter((a) =>
        a.getAttribute('href')?.startsWith('#/alliance/'),
      ),
    ).toHaveLength(2);
  });
});

describe('movesEmptyText', () => {
  it('says who the feed is for when the alliance is one of ours', () => {
    expect(movesEmptyText(true)).toBe(
      'Nothing to show. For one of our alliances this feed is for its members, officers and admins.',
    );
  });
  it('says nothing was observed for anybody else', () => {
    expect(movesEmptyText(false)).toBe('No moves observed in the last 90 days.');
  });
});

describe('MovesFeed', () => {
  const many = Array.from({ length: MOVES_PAGE_SIZE + 5 }, (_, i) =>
    move(i + 1, i % 2 === 0 ? 'in' : 'out', { id: null, tag: null, server: null }, i + 1),
  );
  const pressed = (container: HTMLElement) =>
    [...container.querySelectorAll('.filter-chip')].map((chip) => [
      chip.textContent,
      chip.getAttribute('aria-pressed'),
    ]);

  it('pages past twenty rows and states the caveat', () => {
    const { container } = render(<MovesFeed now={NOW} ownAlliance={false} rows={many} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(MOVES_PAGE_SIZE);
    expect(container.querySelector('.pager')).not.toBeNull();
    expect(container.querySelector('.alliance-panel-foot')?.textContent).toContain(
      'Moves are detected when we next observe the player',
    );
    expect(container.querySelector('.moves-count')?.textContent).toBe('25 moves');
  });

  it('filters by direction and goes back to the first page', () => {
    const { container, getByRole } = render(
      <MovesFeed now={NOW} ownAlliance={false} rows={many} />,
    );
    fireEvent.click(getByRole('button', { name: 'Next page' }));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
    fireEvent.click(getByRole('button', { name: 'Out' }));
    expect(pressed(container)).toEqual([
      ['All', 'false'],
      ['In', 'false'],
      ['Out', 'true'],
    ]);
    const rows = bodyRows(container);
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row[1] === 'Out')).toBe(true);
    expect(container.querySelector('.pager')).toBeNull();
  });

  it('offers Relocated only when a move is one', () => {
    const { container } = render(<MovesFeed now={NOW} ownAlliance={false} rows={ROWS} />);
    expect(pressed(container).map(([label]) => label)).toEqual(['All', 'In', 'Out', 'Relocated']);
  });

  it('words the empty state by whose alliance it is', () => {
    const { container } = render(<MovesFeed now={NOW} ownAlliance rows={[]} />);
    expect(container.querySelector('.empty')?.textContent).toBe(movesEmptyText(true));
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('RecentMovesView', () => {
  it('shows the newest five and points at the full feed', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      move(i + 1, 'in', { id: null, tag: null, server: null }, 8 - i),
    );
    const { container } = render(
      <RecentMovesView allianceId={OTHER} now={NOW} ownAlliance={false} rows={rows} />,
    );
    expect(bodyRows(container).map((row) => row[0])).toEqual([
      'Player8',
      'Player7',
      'Player6',
      'Player5',
      'Player4',
    ]);
    expect(container.querySelector('.alliance-panel-foot a')?.getAttribute('href')).toBe(
      `#/alliance/${OTHER}/moves`,
    );
  });

  it('has no link to a feed that would be empty', () => {
    const { container } = render(
      <RecentMovesView allianceId={OTHER} now={NOW} ownAlliance={false} rows={[]} />,
    );
    expect(container.querySelector('.empty')?.textContent).toBe(movesEmptyText(false));
    expect(container.querySelector('.alliance-panel-foot')).toBeNull();
  });
});
