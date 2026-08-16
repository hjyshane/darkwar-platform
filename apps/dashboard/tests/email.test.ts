import { describe, expect, test } from 'vitest';
import { canSubmitEmail, emailProblem } from '../src/features/account/email';

/** The address-change form's checks.
 *
 * Deliberately loose. GoTrue validates properly; this only catches the two
 * mistakes a person actually makes before spending a round trip on them. A
 * strict regex here would reject valid addresses the real validator accepts,
 * which is the worse failure of the two.
 */
describe('emailProblem', () => {
  test('says nothing about an untouched field', () => {
    expect(emailProblem('', 'a@b.com')).toBeNull();
  });

  test('catches the shape mistakes', () => {
    expect(emailProblem('nope', 'a@b.com')).toBe('That does not look like an address.');
    expect(emailProblem('@b.com', 'a@b.com')).toBe('That does not look like an address.');
    expect(emailProblem('a@', 'a@b.com')).toBe('That does not look like an address.');
    expect(emailProblem('a b@c.com', 'a@b.com')).toBe('Addresses do not contain spaces.');
  });

  test('refuses the address you already have, whatever the case', () => {
    // Worth its own case: the request would otherwise be accepted and send a
    // confirmation for a change that is not a change.
    expect(emailProblem('a@b.com', 'a@b.com')).toBe('That is already your address.');
    expect(emailProblem('A@B.com', 'a@b.com')).toBe('That is already your address.');
  });

  test('accepts a plausible new address, and tolerates surrounding space', () => {
    expect(emailProblem('new@example.com', 'a@b.com')).toBeNull();
    expect(emailProblem('  new@example.com  ', 'a@b.com')).toBeNull();
  });

  test('does not crash when the current address is unknown', () => {
    expect(emailProblem('new@example.com', null)).toBeNull();
  });
});

describe('canSubmitEmail', () => {
  test('needs a non-empty address with no problem', () => {
    expect(canSubmitEmail('new@example.com', 'a@b.com')).toBe(true);
    // Empty is null-problem but still not submittable.
    expect(canSubmitEmail('', 'a@b.com')).toBe(false);
    expect(canSubmitEmail('   ', 'a@b.com')).toBe(false);
    expect(canSubmitEmail('a@b.com', 'a@b.com')).toBe(false);
  });
});
