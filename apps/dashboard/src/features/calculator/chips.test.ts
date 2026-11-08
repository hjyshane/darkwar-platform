import { describe, expect, it } from 'vitest';
import { chipLabel, chipLevel, chipStepName, chipSubjectName, counterName } from './chips';

describe('chip labels', () => {
  it('reads a flat level as the game draws the state', () => {
    // Pinned against gamedata/catalog.py chip_label.
    expect(chipLabel(0)).toBe('0★ 0/10');
    expect(chipLabel(5)).toBe('0★ 5/10');
    expect(chipLabel(10)).toBe('1★ 0/10');
    expect(chipLabel(100)).toBe('10★ 0/10');
  });

  it('clamps a level outside the track instead of inventing a star', () => {
    expect(chipLabel(-3)).toBe('0★ 0/10');
    expect(chipLabel(140)).toBe('10★ 0/10');
  });

  it('names a step from the state before it to the state reached', () => {
    expect(chipStepName(5)).toBe('0★ 4/10 → 0★ 5/10');
    expect(chipStepName(10)).toBe('0★ 9/10 → 1★ 0/10');
    expect(chipLevel(1, 0)).toBe(10);
  });

  it('names subjects and counters for a reader', () => {
    expect(chipSubjectName('4')).toBe('Purple chip');
    expect(chipSubjectName('9')).toBe('Chip quality 9');
    expect(counterName('chip_exp')).toBe('Star-up EXP');
    expect(counterName('chip_duplicate:5')).toBe('Orange chip duplicates');
    expect(counterName('something_else')).toBe('something_else');
  });
});
