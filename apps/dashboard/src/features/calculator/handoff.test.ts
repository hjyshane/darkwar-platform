import { describe, expect, it } from 'vitest';
import { routeFromHash } from '../../lib/route';
import { blankAccount } from '../planner/accounts';
import {
  canHandOff,
  currentLevel,
  handoffTarget,
  plannerHandoffHash,
  readHandoff,
  stripHandoff,
} from './handoff';

const BANK_30 = { kind: 'building', subject: '409000', to: 30 } as const;

describe('the hand-off address', () => {
  it('round-trips one target and still names the planner route', () => {
    const hash = plannerHandoffHash(BANK_30);
    expect(hash).toBe('#/planner?target=building%3A409000%3A30');
    expect(readHandoff(hash)).toEqual(BANK_30);
    expect(routeFromHash(hash)).toBe('planner');
  });

  it('is read on a planner tab address too, and nowhere else', () => {
    expect(readHandoff('#/planner/raise?target=vehicle:0:12')).toEqual({
      kind: 'vehicle',
      subject: '0',
      to: 12,
    });
    expect(readHandoff('#/calculator?target=building:409000:30')).toBeNull();
    expect(readHandoff('#/planner')).toBeNull();
  });

  it('refuses what the planner cannot take', () => {
    expect(readHandoff('#/planner?target=hero:1017:60')).toBeNull();
    expect(readHandoff('#/planner?target=hero_gear:level:q5:60')).toBeNull();
    expect(readHandoff('#/planner?target=building:409000:0')).toBeNull();
    expect(readHandoff('#/planner?target=building:409000:abc')).toBeNull();
    expect(readHandoff('#/planner?target=building:<b>:30')).toBeNull();
  });

  it('strips the target and keeps the rest of the address', () => {
    expect(stripHandoff('#/planner?target=building:409000:30')).toBe('#/planner');
    expect(stripHandoff('#/planner/raise?x=1&target=building:409000:30')).toBe(
      '#/planner/raise?x=1',
    );
    expect(stripHandoff('#/planner')).toBe('#/planner');
  });

  it('offers the button only for account-independent kinds', () => {
    expect(canHandOff('building')).toBe(true);
    expect(canHandOff('vehicle_part')).toBe(true);
    expect(canHandOff('hero_gear')).toBe(false);
    expect(canHandOff('chip')).toBe(false);
    expect(canHandOff('pet')).toBe(false);
  });
});

describe('the planner target', () => {
  const account = {
    ...blankAccount('p1', 'Tester', 580),
    buildings: { '409000': 28 },
    science: { '908200': 3 },
    heroExclusives: { '40002': 7 },
    vehicle: { level: 12 },
    vehicleParts: { '1': 27 },
  };

  it('takes from the account what the thing is at now', () => {
    expect(currentLevel(account, BANK_30)).toBe(28);
    expect(currentLevel(account, { kind: 'research', subject: '908200', to: 5 })).toBe(3);
    expect(currentLevel(account, { kind: 'exclusive', subject: '40002', to: 9 })).toBe(7);
    expect(currentLevel(account, { kind: 'vehicle', subject: '0', to: 13 })).toBe(12);
    expect(currentLevel(account, { kind: 'vehicle_part', subject: '1', to: 28 })).toBe(27);
    expect(currentLevel(account, { kind: 'building', subject: '438000', to: 5 })).toBe(0);
  });

  it('is the climb from the account level to the calculator target', () => {
    expect(handoffTarget(BANK_30, account, 'Bank')).toEqual({
      kind: 'building',
      subject: '409000',
      name: 'Bank',
      from: 28,
      to: 30,
    });
  });

  it('is nothing when the account is already there', () => {
    expect(handoffTarget({ ...BANK_30, to: 28 }, account, 'Bank')).toBeNull();
    expect(handoffTarget({ ...BANK_30, to: 20 }, account, 'Bank')).toBeNull();
  });
});
