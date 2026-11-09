import { describe, expect, it } from 'vitest';
import { mergeScoreItems, scoreItemMapFrom } from './scoreItems';
import type { PointTablePayload } from './sections/pointTable';

const map = scoreItemMapFrom([
  { score_id: '1000020101', item_ref: { kind: 'item', id: '253042' }, per: 1 },
  { score_id: '441000', item_ref: { kind: 'resource', id: '25' }, per: 100 },
  { score_id: 'broken', item_ref: 'shard', per: 1 },
  { score_id: 'noper', item_ref: { kind: 'item', id: '1' }, per: null },
]);

const imported: PointTablePayload = {
  day: 4,
  theme: 'Training Day',
  rows: [
    { action: 'Consume 1 orange hero shard', points: 300, score_id: '1000020101', per: 1 },
    { action: 'Gather 100 wood', points: 10, score_id: '441000', per: 100 },
    { action: 'Defeat 1 monster', points: 40, score_id: '9999', per: 1 },
    {
      action: 'Officer says this is candy',
      points: 1,
      score_id: '1000020101',
      item_ref: { kind: 'item', id: '300100' },
    },
  ],
};

describe('scoreItemMapFrom', () => {
  it('keeps rows whose item_ref parses and defaults per to 1', () => {
    expect([...map.keys()]).toEqual(['1000020101', '441000', 'noper']);
    expect(map.get('noper')?.per).toBe(1);
  });
});

describe('mergeScoreItems', () => {
  const merged = mergeScoreItems(imported, map);

  it('gives a bare client row the mapped item and per', () => {
    expect(merged.rows[0]).toEqual({
      action: 'Consume 1 orange hero shard',
      points: 300,
      score_id: '1000020101',
      item_ref: { kind: 'item', id: '253042' },
      per: 1,
    });
    expect(merged.rows[1]?.item_ref).toEqual({ kind: 'resource', id: '25' });
  });

  it('leaves a score id the map does not know bare', () => {
    expect(merged.rows[2]?.item_ref).toBeUndefined();
  });

  it('never overrides an item_ref the row already carries', () => {
    expect(merged.rows[3]?.item_ref).toEqual({ kind: 'item', id: '300100' });
  });

  it('does not mutate the table it was given', () => {
    expect(imported.rows[0]?.item_ref).toBeUndefined();
    expect(merged).not.toBe(imported);
  });
});
