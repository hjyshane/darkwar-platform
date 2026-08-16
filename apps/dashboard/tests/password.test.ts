import { describe, expect, test } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  canSubmitPassword,
  passwordProblem,
} from '../src/features/account/password';

/** The two-field password form's rules.
 *
 * The messages are the whole feature. This is the screen somebody reaches when
 * the confirmation mail never arrived and an admin handed them a temporary
 * password — so "invalid" would be the worst possible thing to say, and a typo
 * that slips through locks them out of an account whose reset path is broken.
 */
describe('passwordProblem', () => {
  test('says nothing before anything is typed', () => {
    // An error message on an empty form is noise: nobody has made a mistake
    // yet, they have simply not started.
    expect(passwordProblem('', '')).toBeNull();
  });

  test('names the length rule rather than calling it invalid', () => {
    expect(passwordProblem('abc', '')).toBe(`At least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  test('waits for the second field before complaining they differ', () => {
    // Halfway through typing the confirmation, "they do not match" is true and
    // useless.
    expect(passwordProblem('longenough', '')).toBeNull();
    expect(passwordProblem('longenough', 'long')).toBe('The two do not match.');
  });

  test('reports length before mismatch when both are wrong', () => {
    // Otherwise the reader fixes the match, still fails, and has to be told a
    // second thing they could have been told first.
    expect(passwordProblem('abc', 'xyz')).toBe(`At least ${MIN_PASSWORD_LENGTH} characters.`);
  });

  test('is silent on a good pair', () => {
    expect(passwordProblem('longenough', 'longenough')).toBeNull();
  });
});

describe('canSubmitPassword', () => {
  test('allows a matching pair of sufficient length', () => {
    expect(canSubmitPassword('longenough', 'longenough')).toBe(true);
  });

  test('refuses an empty form, a short pair, and a mismatch', () => {
    // The empty case matters most: `passwordProblem` deliberately returns null
    // there, so submission cannot lean on "no problem" alone.
    expect(canSubmitPassword('', '')).toBe(false);
    expect(canSubmitPassword('abc', 'abc')).toBe(false);
    expect(canSubmitPassword('longenough', 'longenoughX')).toBe(false);
  });

  test('accepts exactly the minimum length', () => {
    const exact = 'x'.repeat(MIN_PASSWORD_LENGTH);
    expect(canSubmitPassword(exact, exact)).toBe(true);
    expect(canSubmitPassword(exact.slice(1), exact.slice(1))).toBe(false);
  });
});
