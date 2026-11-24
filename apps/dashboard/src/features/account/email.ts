import { type Translate, english } from '../../lib/i18n/core';

/** Changing the address your account signs in with.
 *
 * UNLIKE THE PASSWORD, THIS ONE NEEDS EMAIL TO WORK. `updateUser({ email })`
 * does not change anything on its own — it sends a confirmation link, and
 * `double_confirm_changes = true` in config means it goes to BOTH the old and
 * the new address. Until custom SMTP is configured, the request will be
 * accepted and then nothing will happen.
 *
 * That is worth saying on the screen rather than letting somebody conclude the
 * button is broken, which is why the form carries a warning the password form
 * does not need.
 */

/** What is wrong with this address, or null when nothing is.
 *
 * Deliberately a loose check. The database and GoTrue both validate properly;
 * this exists to catch the two mistakes a person actually makes — leaving it
 * blank, and typing the address they already have — before a round trip. A
 * strict regex here would reject valid addresses that the real validator
 * accepts, which is the worse failure.
 */
export function emailProblem(
  next: string,
  current: string | null,
  t: Translate = english,
): string | null {
  const trimmed = next.trim();
  if (trimmed === '') {
    return null;
  }
  if (!trimmed.includes('@') || trimmed.startsWith('@') || trimmed.endsWith('@')) {
    return t('That does not look like an address.');
  }
  if (trimmed.includes(' ')) {
    return t('Addresses do not contain spaces.');
  }
  if (current !== null && trimmed.toLowerCase() === current.toLowerCase()) {
    return t('That is already your address.');
  }
  return null;
}

export function canSubmitEmail(next: string, current: string | null): boolean {
  return next.trim() !== '' && emailProblem(next, current) === null;
}
