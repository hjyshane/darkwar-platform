// Hive safety (0330): the decisions the editor and the page make about a
// newer save, a refused one, a stamp and a deleted plan. Pure, so they are
// tested here rather than through a rendered editor.

import { describe, expect, test } from 'vitest';
import { offsetKey } from '../../lib/hiveFormation';
import {
  PlanDeletedError,
  StaleSaveError,
  boardVersionOf,
  draftStatus,
  keptUntil,
  peopleByOffset,
  pickFormation,
  stampText,
  stillRestorable,
  toWriteError,
} from './hiveSafety';

describe('draftStatus', () => {
  test('a board at the version the draft was built from is current', () => {
    expect(draftStatus({ unsaved: false, baseVersion: 3, boardVersion: 3 })).toBe('current');
  });

  test('a newer board with nothing unsaved is adopted quietly', () => {
    expect(draftStatus({ unsaved: false, baseVersion: 3, boardVersion: 4 })).toBe('behind');
  });

  test('a newer board under unsaved changes is a conflict', () => {
    expect(draftStatus({ unsaved: true, baseVersion: 3, boardVersion: 4 })).toBe('conflict');
  });

  test("the officer's own save refreshing back is not a conflict", () => {
    expect(draftStatus({ unsaved: true, baseVersion: 4, boardVersion: 4 })).toBe('current');
  });

  test('a refresh older than the version the save returned is not a conflict either', () => {
    expect(draftStatus({ unsaved: true, baseVersion: 5, boardVersion: 4 })).toBe('current');
  });
});

describe('boardVersionOf', () => {
  test('a plan with no tiles yet takes the version from the plan itself', () => {
    expect(boardVersionOf([], 7)).toBe(7);
  });

  test('otherwise the board says which version it was read from', () => {
    expect(boardVersionOf([{ formationVersion: 9 }], 7)).toBe(9);
  });

  test('a row without a version falls back to the plan', () => {
    expect(boardVersionOf([{ formationVersion: null }], 7)).toBe(7);
  });
});

describe('toWriteError', () => {
  test('a version refusal is a stale save', () => {
    const error = toWriteError({
      code: 'PT409',
      message: 'somebody else saved this plan after you opened it',
    });
    expect(error).toBeInstanceOf(StaleSaveError);
    expect((error as StaleSaveError).kind).toBe('version');
  });

  test('an anchor refusal is a stale move', () => {
    const error = toWriteError({
      code: 'PT409',
      message: 'the anchor was moved after you opened this plan',
    });
    expect(error).toBeInstanceOf(StaleSaveError);
    expect((error as StaleSaveError).kind).toBe('anchor');
  });

  test('a deleted plan says so', () => {
    expect(toWriteError({ code: 'P0002', message: 'this plan was deleted' })).toBeInstanceOf(
      PlanDeletedError,
    );
  });

  test('anything else keeps the database message', () => {
    const error = toWriteError({ code: '23514', message: 'x' });
    expect(error).not.toBeInstanceOf(StaleSaveError);
    expect(error).not.toBeInstanceOf(PlanDeletedError);
    expect(error.message).toBe('x');
  });
});

describe('peopleByOffset', () => {
  test('one entry per tile, empty where nobody stands', () => {
    const placements = new Map([[offsetKey({ dx: 0, dy: 0 }), { playerId: 'p1', pinned: true }]]);
    expect(
      peopleByOffset(
        [
          { dx: 0, dy: 0 },
          { dx: 3, dy: 0 },
        ],
        placements,
      ),
    ).toEqual([
      { dx: 0, dy: 0, player_id: 'p1', pinned: true },
      { dx: 3, dy: 0, player_id: null, pinned: false },
    ]);
  });
});

describe('stampText', () => {
  const now = new Date('2026-11-15T18:00:00Z');

  test('today: the name and the time', () => {
    expect(stampText('Mina', '2026-11-15T16:32:00Z', 'UTC', now)).toBe(
      'Last changed by Mina · 16:32',
    );
  });

  test('another day: the date as well', () => {
    expect(stampText('Mina', '2026-11-14T16:32:00Z', 'UTC', now)).toBe(
      'Last changed by Mina · 14 Nov 16:32',
    );
  });

  test("in the reader's chosen clock", () => {
    // 16:32 UTC on the 15th is 01:32 on the 16th in Seoul, the same Seoul day
    // as `now` (03:00 on the 16th there), so no date.
    expect(stampText('Mina', '2026-11-15T16:32:00Z', 'Asia/Seoul', now)).toBe(
      'Last changed by Mina · 01:32',
    );
  });

  test("'today' is judged in that clock, not in UTC", () => {
    // 14:00 UTC on the 15th is 23:00 on the 15th in Seoul — a different Seoul
    // day from `now`, though the same UTC day.
    expect(stampText('Mina', '2026-11-15T14:00:00Z', 'Asia/Seoul', now)).toBe(
      'Last changed by Mina · 15 Nov 23:00',
    );
  });

  test('an editor with no name is "someone", not a blank', () => {
    expect(stampText(null, '2026-11-15T16:32:00Z', 'UTC', now)).toBe(
      'Last changed by someone · 16:32',
    );
  });
});

describe('pickFormation', () => {
  const live = { formationId: 'live', isActive: true, deletedAt: null };
  const draft = { formationId: 'draft', isActive: false, deletedAt: null };
  const gone = { formationId: 'gone', isActive: false, deletedAt: '2026-11-15T10:00:00Z' };

  test('the plan picked in the picker', () => {
    expect(pickFormation({ plans: [live, draft], chosenId: 'draft', shownId: null })).toEqual({
      formation: draft,
      deletedUnderUs: false,
    });
  });

  test('with nothing picked, the live plan', () => {
    expect(pickFormation({ plans: [draft, live], chosenId: null, shownId: null })).toEqual({
      formation: live,
      deletedUnderUs: false,
    });
  });

  test('the plan already on screen stays there when another is made live', () => {
    expect(
      pickFormation({ plans: [live, draft], chosenId: null, shownId: 'draft' }).formation,
    ).toBe(draft);
  });

  test('a plan deleted by somebody else stays on screen, marked, instead of being swapped', () => {
    expect(pickFormation({ plans: [live, gone], chosenId: null, shownId: 'gone' })).toEqual({
      formation: gone,
      deletedUnderUs: true,
    });
  });

  test('a deleted plan is never what opens by default', () => {
    expect(pickFormation({ plans: [gone, draft], chosenId: null, shownId: null })).toEqual({
      formation: draft,
      deletedUnderUs: false,
    });
  });

  test('a plan that is gone altogether falls back to the live one', () => {
    expect(pickFormation({ plans: [live], chosenId: null, shownId: 'purged' }).formation).toBe(
      live,
    );
  });

  test('no plans, no formation', () => {
    expect(pickFormation({ plans: [], chosenId: null, shownId: null })).toEqual({
      formation: null,
      deletedUnderUs: false,
    });
  });
});

describe('keptUntil and stillRestorable', () => {
  test('a deleted plan is kept 30 days from its delete', () => {
    expect(keptUntil('2026-11-12T10:00:00Z').toISOString()).toBe('2026-12-12T10:00:00.000Z');
  });

  test('restorable at 29 days, gone at 30', () => {
    const deleted = '2026-11-12T10:00:00Z';
    expect(stillRestorable(deleted, new Date('2026-12-11T10:00:00Z'))).toBe(true);
    expect(stillRestorable(deleted, new Date('2026-12-12T10:00:00Z'))).toBe(false);
  });
});
