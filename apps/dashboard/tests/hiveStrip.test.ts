import { describe, expect, it } from 'vitest';
import type { BoardSlot, Formation } from '../src/features/hive/hiveFormations';
import { hiveStrip } from '../src/features/hive/strip';

const formation = (over: Partial<Formation> = {}): Formation =>
  ({ serverId: 580, isActive: true, ...over }) as Formation;

const slot = (over: Partial<BoardSlot> = {}): BoardSlot =>
  ({ kind: 'base', spanX: 3, spanY: 3, playerId: null, ...over }) as BoardSlot;

const cell = (label: string, f = formation(), board: BoardSlot[] = []) =>
  hiveStrip(f, board, { x: 491, y: 444 }).find((entry) => entry.label === label);

describe('hiveStrip', () => {
  it('says whether the plan is the live one or a draft', () => {
    expect(cell('Plan')?.value).toBe('Live');
    expect(cell('Plan', formation({ isActive: false }))?.value).toBe('Draft');
  });

  it('counts member bases only, not structures or markers', () => {
    const board = [
      slot(),
      slot({ playerId: 'a' }),
      slot({ kind: 'structure' }),
      slot({ spanX: 1, spanY: 1 }),
    ];

    expect(cell('Bases', formation(), board)?.value).toBe('2');
    expect(cell('Assigned', formation(), board)).toMatchObject({
      value: '1 of 2',
      note: '1 still empty',
    });
  });

  it('says so when every base has a member', () => {
    expect(cell('Assigned', formation(), [slot({ playerId: 'a' })])?.note).toBe(
      'every base has a member',
    );
  });

  it('writes the anchor the way the game shows a coordinate', () => {
    expect(cell('Anchor')?.value).toBe('[X:491 Y:444]');
  });
});
