import { describe, expect, it } from 'vitest';
import {
  arrange,
  isHidden,
  labelOf,
  labelProblem,
  moveKey,
  overrideKey,
  overridesFromRows,
} from './uiOverrides';

const rows = [
  { scope: 'events-hub', key: 'frankie', kind: 'label', value: 'Boss fights' },
  { scope: 'events-hub', key: 'participation', kind: 'hidden', value: 'true' },
  { scope: 'events-hub', key: 'season', kind: 'order', value: '0' },
  { scope: 'events-hub', key: 'blackMoney', kind: 'order', value: '1' },
  { scope: 'other', key: 'frankie', kind: 'label', value: 'Not this one' },
  { scope: 'events-hub', key: 'x', kind: 'weird', value: 'ignored' },
];
const o = overridesFromRows(rows);

describe('labelOf', () => {
  it('is the override when there is one, else the default', () => {
    expect(labelOf(o, 'events-hub', 'frankie', 'Frankie')).toBe('Boss fights');
    expect(labelOf(o, 'events-hub', 'season', 'Season 3')).toBe('Season 3');
  });

  it("is scoped: another screen's name for the same key does not leak", () => {
    expect(labelOf(o, 'events-hub', 'frankie', 'F')).toBe('Boss fights');
    expect(labelOf(o, 'third', 'frankie', 'F')).toBe('F');
  });

  it('ignores a kind it does not know', () => {
    expect(o.has(overrideKey('events-hub', 'x', 'label'))).toBe(false);
  });
});

describe('isHidden', () => {
  it('is only true for a stored hidden flag', () => {
    expect(isHidden(o, 'events-hub', 'participation')).toBe(true);
    expect(isHidden(o, 'events-hub', 'frankie')).toBe(false);
  });
});

describe('arrange', () => {
  const items = ['blackMoney', 'frankie', 'participation', 'season'];

  it('puts the positioned ones first, in position order', () => {
    expect(arrange(items, (k) => k, o, 'events-hub')).toEqual([
      'season',
      'blackMoney',
      'frankie',
      'participation',
    ]);
  });

  it('keeps the code order when nothing is stored', () => {
    expect(arrange(items, (k) => k, new Map(), 'events-hub')).toEqual(items);
  });

  it('does not touch its input', () => {
    const copy = [...items];
    arrange(copy, (k) => k, o, 'events-hub');
    expect(copy).toEqual(items);
  });
});

describe('moveKey', () => {
  const keys = ['a', 'b', 'c'];

  it('gives every key a position after a move', () => {
    expect(moveKey(keys, 'c', -1)).toEqual({ a: 0, c: 1, b: 2 });
  });

  it('cannot move past either end or an unknown key', () => {
    expect(moveKey(keys, 'a', -1)).toBeNull();
    expect(moveKey(keys, 'c', 1)).toBeNull();
    expect(moveKey(keys, 'zzz', 1)).toBeNull();
  });
});

describe('labelProblem', () => {
  it('accepts a plain name', () => {
    expect(labelProblem('Boss fights')).toBeNull();
  });

  it('refuses empty, long, markup and control characters', () => {
    expect(labelProblem('   ')).not.toBeNull();
    expect(labelProblem('x'.repeat(61))).not.toBeNull();
    expect(labelProblem('<b>x</b>')).not.toBeNull();
    expect(labelProblem('a\u0007b')).not.toBeNull();
  });
});
