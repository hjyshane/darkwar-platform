import { describe, expect, test } from 'vitest';
import {
  FormulaError,
  evaluateFormula,
  parseFormula,
  referencedNames,
  runFormula,
} from '../src/lib/formula';

const KNOWN = ['members', 'weekly_donation', 'total_power', 'online'];
const VALUES: Record<string, number | null> = {
  members: 93,
  weekly_donation: 4_350_390,
  total_power: 18_083_043_279,
  online: null, // not observed, or not visible to this reader
};

const run = (text: string) => runFormula(text, KNOWN, VALUES);

describe('arithmetic', () => {
  test('the thing anyone would write first', () => {
    expect(run('weekly_donation / members')).toBeCloseTo(46778.4, 1);
  });

  test('precedence and parentheses', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('2 * (3 + 4) - 5')).toBe(9);
  });

  test('unary minus, including twice', () => {
    expect(run('-5')).toBe(-5);
    expect(run('--5')).toBe(5);
    expect(run('10 - -5')).toBe(15);
  });

  test('decimals', () => {
    expect(run('members * 1.5')).toBe(139.5);
  });

  test('left associativity', () => {
    expect(run('100 - 10 - 5')).toBe(85);
    expect(run('100 / 10 / 2')).toBe(5);
  });
});

describe('unknown is contagious', () => {
  // The whole reason this module is careful. Every value in this app is
  // number | null where null means "not observed" or "not yours to see",
  // never zero (FR-UI-008) — and a formula is the easiest place to lose it.
  test('a null operand makes the result null, not zero', () => {
    expect(run('online + members')).toBeNull();
    expect(run('members + online')).toBeNull();
    expect(run('online * 0')).toBeNull();
    expect(run('-online')).toBeNull();
  });

  test('null survives through parentheses and depth', () => {
    expect(run('(members + (online * 2)) / 3')).toBeNull();
  });

  test('a formula that touches nothing unknown still computes', () => {
    expect(run('members * 2')).toBe(186);
  });

  test('an unknown name is null rather than an exception at evaluation', () => {
    // parseFormula refuses unknown names, so this can only happen if a value
    // map is missing a key the tree was built against — a stale metric list.
    // Null is the honest answer; throwing would take the whole screen down.
    const tree = parseFormula('members + weekly_donation', KNOWN);
    expect(evaluateFormula(tree, { members: 5 })).toBeNull();
  });
});

describe('division has no answer more often than people expect', () => {
  test('by zero is null, not Infinity', () => {
    // Infinity and NaN both reach the screen as text and read like values.
    expect(run('members / 0')).toBeNull();
    expect(run('0 / 0')).toBeNull();
  });

  test('by an unknown is null', () => {
    expect(run('members / online')).toBeNull();
  });
});

describe('what it refuses', () => {
  const bad = (text: string) => () => parseFormula(text, KNOWN);

  test('a name that is not a figure', () => {
    expect(bad('members + moon_phase')).toThrow(FormulaError);
    expect(bad('members + moon_phase')).toThrow(/not a figure/);
  });

  test('anything that is not arithmetic', () => {
    // The parser has no notion of these at all — there is no path from here
    // to a JavaScript evaluation, which is the point of writing one.
    for (const text of [
      'window',
      'process.env',
      'members; alert(1)',
      'fetch("/")',
      'members > 5',
      '[1,2]',
      '`x`',
      'members ?? 1',
    ]) {
      expect(bad(text)).toThrow(FormulaError);
    }
  });

  test('unbalanced parentheses, both directions', () => {
    expect(bad('(members + 1')).toThrow(/never closed/);
    expect(bad('members + 1)')).toThrow(/no "\(" to match/);
  });

  test('an empty or truncated formula', () => {
    expect(bad('')).toThrow(/cannot be empty/);
    expect(bad('   ')).toThrow(/cannot be empty/);
    expect(bad('members +')).toThrow(/ends before it is finished/);
    expect(bad('* 5')).toThrow();
  });

  test('something absurdly long', () => {
    expect(bad(`${'1+'.repeat(200)}1`)).toThrow(/under 200 characters/);
  });
});

describe('referencedNames', () => {
  test('lists what a formula reads, once each', () => {
    const tree = parseFormula('(weekly_donation + weekly_donation) / members', KNOWN);
    expect(referencedNames(tree).sort()).toEqual(['members', 'weekly_donation']);
  });

  test('a formula of pure numbers reads nothing', () => {
    expect(referencedNames(parseFormula('1 + 2', KNOWN))).toEqual([]);
  });
});
