import { describe, expect, it } from 'vitest';
import {
  CALCULATOR_HASH,
  DEFAULT_STATE,
  calculatorHash,
  clampToRange,
  isCalculatorHash,
  parseCalculatorHash,
} from './url';

const SPEC_LINK = '#/calculator?kind=building&subject=409000&from=28&to=30&speed=35&cost=10';

describe('parseCalculatorHash', () => {
  it('reads the example from the spec', () => {
    expect(parseCalculatorHash(SPEC_LINK)).toEqual({
      kind: 'building',
      subject: '409000',
      from: 28,
      to: 30,
      speed: 35,
      cost: 10,
    });
  });

  it('is the default state when nothing is given', () => {
    expect(parseCalculatorHash(CALCULATOR_HASH)).toEqual(DEFAULT_STATE);
    expect(parseCalculatorHash('#/calculator?')).toEqual(DEFAULT_STATE);
  });

  it('falls back to building for a kind it does not know', () => {
    expect(parseCalculatorHash('#/calculator?kind=dragon&subject=1').kind).toBe('building');
    expect(parseCalculatorHash('#/calculator?kind=chip&subject=4').kind).toBe('chip');
  });

  it('clamps levels: to never below from, nothing negative, nothing absurd', () => {
    expect(parseCalculatorHash('#/calculator?from=30&to=28')).toMatchObject({ from: 30, to: 30 });
    expect(parseCalculatorHash('#/calculator?from=-5&to=5000')).toMatchObject({
      from: 0,
      to: 999,
    });
    expect(parseCalculatorHash('#/calculator?from=2.6&to=abc')).toMatchObject({ from: 3, to: 3 });
  });

  it('clamps buffs and ignores what is not a number', () => {
    expect(parseCalculatorHash('#/calculator?speed=-5&cost=abc')).toMatchObject({
      speed: 0,
      cost: 0,
    });
    expect(parseCalculatorHash('#/calculator?speed=99999&cost=250')).toMatchObject({
      speed: 10000,
      cost: 100,
    });
  });

  it('keeps the subjects the catalogue uses and drops anything else', () => {
    expect(parseCalculatorHash('#/calculator?kind=hero_gear&subject=level:q5').subject).toBe(
      'level:q5',
    );
    expect(parseCalculatorHash('#/calculator?subject=<script>').subject).toBeNull();
    expect(parseCalculatorHash('#/calculator?subject=').subject).toBeNull();
  });
});

describe('calculatorHash', () => {
  it('round-trips the spec link', () => {
    expect(calculatorHash(parseCalculatorHash(SPEC_LINK))).toBe(SPEC_LINK);
  });

  it('leaves defaults out so equal states give equal links', () => {
    expect(calculatorHash({ ...DEFAULT_STATE, kind: 'chip', subject: '4', to: 10 })).toBe(
      '#/calculator?kind=chip&subject=4&to=10',
    );
    expect(calculatorHash(DEFAULT_STATE)).toBe('#/calculator?kind=building');
  });
});

describe('clampToRange', () => {
  it('holds the levels inside the subject track once it is known', () => {
    const state = parseCalculatorHash('#/calculator?from=28&to=999');
    expect(clampToRange(state, 30)).toMatchObject({ from: 28, to: 30 });
    expect(clampToRange(parseCalculatorHash('#/calculator?from=50&to=60'), 30)).toMatchObject({
      from: 29,
      to: 30,
    });
    expect(clampToRange(state, 0)).toMatchObject({ from: 0, to: 0 });
  });
});

describe('isCalculatorHash', () => {
  it('knows its own address with or without a query', () => {
    expect(isCalculatorHash(CALCULATOR_HASH)).toBe(true);
    expect(isCalculatorHash(SPEC_LINK)).toBe(true);
    expect(isCalculatorHash('#/calculators')).toBe(false);
    expect(isCalculatorHash('#/planner')).toBe(false);
  });
});
