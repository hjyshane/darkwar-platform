import { describe, expect, it } from 'vitest';
import { tenureCell } from './tenure';

const now = new Date('2026-11-08T12:00:00Z');

describe('tenureCell', () => {
  it('counts whole days since the first roster row', () => {
    expect(tenureCell('2026-09-24T12:00:00Z', 30, now)).toEqual({
      kind: 'tenure',
      days: 45,
      since: '2026-09-24T12:00:00Z',
    });
  });
  it('a first sighting today is day 0', () => {
    expect(tenureCell('2026-11-08T02:05:00Z', 30, now)).toMatchObject({ kind: 'tenure', days: 0 });
  });
  it('falls back to HQ level when the roster is not readable or not there', () => {
    expect(tenureCell(null, 30, now)).toEqual({ kind: 'hq', level: 30 });
  });
  it('is null with neither', () => {
    expect(tenureCell(null, null, now)).toBeNull();
  });
});
