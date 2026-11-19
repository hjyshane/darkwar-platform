import { describe, expect, it } from 'vitest';
import { scoreItemMapFrom } from './scoreItems';

const map = scoreItemMapFrom([
  { score_id: '1000020101', item_ref: { kind: 'item', id: '253042' }, per: 1 },
  { score_id: '441000', item_ref: { kind: 'resource', id: '25' }, per: 100 },
  { score_id: 'broken', item_ref: 'shard', per: 1 },
  { score_id: 'noper', item_ref: { kind: 'item', id: '1' }, per: null },
]);

describe('scoreItemMapFrom', () => {
  it('keeps rows whose item_ref parses and defaults per to 1', () => {
    expect([...map.keys()]).toEqual(['1000020101', '441000', 'noper']);
    expect(map.get('noper')?.per).toBe(1);
  });
});
