import { describe, expect, it } from 'vitest';
import type { StripCell } from '../src/components/Strip';
import type { ArenaEntryRow, ArenaHeader } from '../src/features/arena/ArenaTable';
import { arenaStrip } from '../src/features/arena/strip';
import type { BoardRow } from '../src/features/crossRankings/boards';
import { boardStrip } from '../src/features/crossRankings/strip';
import type { AllianceRankingRow } from '../src/features/rankings/AllianceRankingTable';
import { allianceStrip } from '../src/features/rankings/strip';

const NOW = new Date('2026-10-10T12:00:00Z');
const HOUR_AGO = '2026-10-10T11:00:00Z';
const DAY_AGO = '2026-10-09T12:00:00Z';

const alliance = (over: Partial<AllianceRankingRow> = {}): AllianceRankingRow => ({
  snapshot_id: 's',
  alliance_id: 'a',
  external_id: 'e',
  server_id: 580,
  rank: 1,
  name: 'Hellbound',
  code: 'CBFW',
  power: 4_000_000_000,
  member_count: 90,
  captured_at: HOUR_AGO,
  ...over,
});

const cell = (cells: StripCell[], label: string) => cells.find((entry) => entry.label === label);

describe('allianceStrip', () => {
  it('is empty with nothing on the board', () => {
    expect(allianceStrip([], NOW)).toEqual([]);
  });

  it('counts the alliances and the servers they are on', () => {
    const rows = [alliance(), alliance({ server_id: 581 }), alliance({ server_id: 581 })];

    expect(cell(allianceStrip(rows, NOW), 'Alliances')).toMatchObject({
      value: '3',
      note: 'on 2 servers',
    });
    expect(cell(allianceStrip([alliance()], NOW), 'Alliances')?.note).toBe('on 1 server');
  });

  it('names the strongest with its tag, and skips a row with no power', () => {
    const rows = [
      alliance({ name: 'Ghost', code: null, power: null }),
      alliance({ name: 'Small', code: 'SM', power: 10 }),
      alliance({ name: 'Big', code: 'BG', power: 5_000_000_000 }),
    ];

    expect(cell(allianceStrip(rows, NOW), 'Strongest')).toMatchObject({
      value: '[BG] Big',
      note: '5B power',
    });
  });

  it('adds up the known powers only, and shows nothing when none is known', () => {
    expect(
      cell(
        allianceStrip([alliance({ power: 1_000 }), alliance({ power: null })], NOW),
        'Combined power',
      )?.value,
    ).toBe('1K');
    expect(
      cell(allianceStrip([alliance({ power: null })], NOW), 'Combined power')?.value,
    ).toBeNull();
  });

  it('gives the age of the newest capture', () => {
    const rows = [alliance({ captured_at: DAY_AGO }), alliance({ captured_at: HOUR_AGO })];

    expect(cell(allianceStrip(rows, NOW), 'Newest capture')?.value).toBe('1h ago');
  });
});

const player = (over: Partial<BoardRow> = {}): BoardRow => ({
  id: 'r',
  playerId: null,
  rank: 1,
  name: 'Shane',
  game_uid: 58001,
  server_id: 580,
  value: 61_200_000,
  unit_id: null,
  captured_at: HOUR_AGO,
  ...over,
});

describe('boardStrip', () => {
  it('is empty with nothing on the board', () => {
    expect(boardStrip([], 'Power', NOW)).toEqual([]);
  });

  it('names the player ranked first, whatever order the rows came in', () => {
    const rows = [player({ rank: 3, name: 'Third' }), player({ rank: 1, name: 'First' })];

    expect(cell(boardStrip(rows, 'Power', NOW), 'Top')).toMatchObject({
      value: 'First',
      note: 'power 61.2M',
    });
  });

  it('falls back to the UID for an unnamed top player', () => {
    expect(cell(boardStrip([player({ name: null })], 'Kills', NOW), 'Top')?.value).toBe(
      'UID 58001',
    );
  });

  it('says which server has the most players, the lower number winning a tie', () => {
    const rows = [
      player({ server_id: 581 }),
      player({ server_id: 580 }),
      player({ server_id: 580 }),
      player({ server_id: 581 }),
    ];

    expect(cell(boardStrip(rows, 'Power', NOW), 'Most on the board')).toMatchObject({
      value: 'Server 580',
      note: '2 players',
    });
    expect(cell(boardStrip(rows, 'Power', NOW), 'Players')?.note).toBe('from 2 servers');
  });
});

const header: Pick<ArenaHeader, 'captured_at' | 'week_start'> = {
  captured_at: HOUR_AGO,
  week_start: '2026-10-05T00:00:00Z',
};

const entry = (over: Partial<ArenaEntryRow> = {}): ArenaEntryRow =>
  ({
    snapshot_id: 's',
    player_id: null,
    rank: 1,
    name: 'Ann',
    game_uid: 1,
    server_id: 580,
    alliance_name: null,
    alliance_code: null,
    score: 1500,
    defense_power: 1_000_000,
    lineup: [],
    composition: null,
    ...over,
  }) as unknown as ArenaEntryRow;

describe('arenaStrip', () => {
  it('names the top entry and its score', () => {
    const entries = [entry({ rank: 2, name: 'Second' }), entry({ rank: 1, name: 'First' })];

    expect(cell(arenaStrip(header, entries, NOW), 'Top')).toMatchObject({
      value: 'First',
      note: 'score 1,500',
    });
  });

  it('averages the defence power of the entries that have one', () => {
    const entries = [
      entry({ defense_power: 1_000_000 }),
      entry({ defense_power: 3_000_000 }),
      entry({ defense_power: null }),
    ];

    expect(cell(arenaStrip(header, entries, NOW), 'Average defence')?.value).toBe('2M');
  });

  it('shows no average when nobody has a defence figure', () => {
    expect(
      cell(arenaStrip(header, [entry({ defense_power: null })], NOW), 'Average defence')?.value,
    ).toBeNull();
  });

  it('says when the board was captured and for which week', () => {
    expect(cell(arenaStrip(header, [entry()], NOW), 'Captured')).toMatchObject({
      value: '1h ago',
      note: 'week of 2026-10-05',
    });
  });
});
