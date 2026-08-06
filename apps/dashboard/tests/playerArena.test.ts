import { describe, expect, test } from 'vitest';
import type { ArenaBoardRecord, ArenaEntryRecord } from '../src/features/player/playerArena';
import {
  growthNote,
  growthTone,
  newestPerLeague,
  percent,
} from '../src/features/player/playerArena';

function entry(over: Partial<ArenaEntryRecord> & Pick<ArenaEntryRecord, 'snapshot_id'>) {
  return {
    arena_snapshot_id: 'gold-late',
    rank: 4,
    score: 1500,
    defense_power: 400_000_000,
    ...over,
  } as ArenaEntryRecord;
}

const boards: ArenaBoardRecord[] = [
  {
    snapshot_id: 'gold-early',
    league: 1,
    week_start: '2026-07-20T02:00:00Z',
    captured_at: '2026-07-24T05:00:00Z',
  },
  {
    snapshot_id: 'gold-late',
    league: 1,
    week_start: '2026-07-27T02:00:00Z',
    captured_at: '2026-07-30T18:38:21Z',
  },
  {
    snapshot_id: 'silver',
    league: 2,
    week_start: '2026-07-27T02:00:00Z',
    captured_at: '2026-07-30T18:38:23Z',
  },
];

describe('a player’s arena boards', () => {
  // The bug 0062 fixed, one level up: "their latest arena entry" answers with
  // whichever league was captured last — here Silver, by two seconds — and
  // drops the other board entirely.
  test('both leagues survive, not just the one captured last', () => {
    const result = newestPerLeague(
      [
        entry({ snapshot_id: 'e-gold' }),
        entry({ snapshot_id: 'e-silver', arena_snapshot_id: 'silver' }),
      ],
      boards,
    );

    expect(result.map((row) => row.league)).toEqual([1, 2]);
  });

  test('within a league the newest board wins', () => {
    const result = newestPerLeague(
      [
        entry({ snapshot_id: 'e-new', rank: 4 }),
        entry({ snapshot_id: 'e-old', arena_snapshot_id: 'gold-early', rank: 11 }),
      ],
      boards,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.rank).toBe(4);
    expect(result[0]?.weekStart).toBe('2026-07-27T02:00:00Z');
  });

  // Order matters: the reduction must not depend on the query returning rows
  // newest-first, because that ordering is one `.order()` call away from
  // being changed by someone tuning an unrelated query.
  test('the newest wins whichever order the rows arrive in', () => {
    const forwards = newestPerLeague(
      [
        entry({ snapshot_id: 'e-new' }),
        entry({ snapshot_id: 'e-old', arena_snapshot_id: 'gold-early' }),
      ],
      boards,
    );
    const backwards = newestPerLeague(
      [
        entry({ snapshot_id: 'e-old', arena_snapshot_id: 'gold-early' }),
        entry({ snapshot_id: 'e-new' }),
      ],
      boards,
    );

    expect(forwards[0]?.entryId).toBe(backwards[0]?.entryId);
  });

  // A rank with no board has no week and no "as of", which is not something
  // to render half of.
  test('an entry whose board was not fetched is dropped, not shown league-less', () => {
    expect(
      newestPerLeague([entry({ snapshot_id: 'e', arena_snapshot_id: 'missing' })], boards),
    ).toEqual([]);
  });

  test('a board that never said which league it is keeps its own bucket', () => {
    const result = newestPerLeague(
      [
        entry({ snapshot_id: 'e-gold' }),
        entry({ snapshot_id: 'e-old', arena_snapshot_id: 'unknown' }),
      ],
      [
        ...boards,
        {
          snapshot_id: 'unknown',
          league: null,
          week_start: '2026-07-27T02:00:00Z',
          captured_at: '2026-07-28T00:00:00Z',
        },
      ],
    );

    // Two boards, and the unknown one sorts last rather than being folded
    // into Gold.
    expect(result.map((row) => row.league)).toEqual([1, null]);
  });
});

describe('growth figures', () => {
  test('the sign carries the direction, not only the colour', () => {
    expect(percent(3.42)).toBe('+3.4%');
    expect(percent(-1.05)).toBe('-1.1%');
  });

  // Flat is an observation. `?? 0` in the other direction — rendering "0.0%"
  // for a player never measured — is the FR-UI-008 mistake.
  test('flat renders, unmeasured does not', () => {
    expect(percent(0)).toBe('0.0%');
    expect(percent(null)).toBeNull();
    expect(percent(undefined)).toBeNull();
  });

  test('the note names the day the figure is measured against', () => {
    expect(growthNote('2026-07-29T02:05:00Z')).toBe('since 2026-07-29');
    expect(growthNote(null)).toBeUndefined();
  });

  test('up is green, down is red', () => {
    expect(growthTone(3.42)).toBe('up');
    expect(growthTone(-1.05)).toBe('down');
  });

  // The one place tone and text deliberately disagree. `percent` prints 0 as a
  // real reading, and it is; but no change is the absence of a direction, not a
  // third one, so the tile keeps the ordinary colour.
  test('flat gets no colour, and unmeasured gets no tone at all', () => {
    expect(growthTone(0)).toBe('flat');
    expect(growthTone(null)).toBeUndefined();
    expect(growthTone(undefined)).toBeUndefined();
  });
});
