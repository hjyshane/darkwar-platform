/** Changing your own password, from inside a session (no email involved).
 *
 * This is the one recovery path that works while SMTP is unconfigured:
 * `updateUser` acts on the signed-in session, so nothing has to be delivered.
 * A member handed a temporary password out of band can set their own here
 * rather than living with one somebody else chose.
 *
 * `secure_password_change` is off in config, so Supabase does not demand
 * reauthentication. That is what makes this work without mail — and it is also
 * why the form asks for the new password twice rather than once: the only
 * guard against a typo is the reader, and a mistyped password on an account
 * whose reset path is broken locks somebody out of the alliance.
 */

/** The shortest password the project accepts, mirroring
 * `minimum_password_length` in `supabase/config.toml`.
 *
 * Duplicated on purpose and worth saying why: the database refuses a short
 * password either way, so this is not the boundary. It is here so the refusal
 * arrives as you type instead of after a round trip that says
 * "Password should be at least 6 characters" in the API's words. If the config
 * changes, this number is wrong in the direction of being stricter than
 * necessary, which is the harmless direction.
 */
export const MIN_PASSWORD_LENGTH = 6;

/** What is wrong with this pair, or null when nothing is.
 *
 * Pure, and exported for its own test: the messages are the whole feature. A
 * password form that says "invalid" teaches nobody anything, and this is the
 * screen somebody reaches when they are already locked out of the normal one.
 */
export function passwordProblem(next: string, confirm: string): string | null {
  if (next === '') {
    return null;
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `At least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // Checked before the match, because "they do not match" on two fields that
  // are both wrong sends the reader looking at the wrong problem.
  if (confirm === '') {
    return null;
  }
  if (next !== confirm) {
    return 'The two do not match.';
  }
  return null;
}

/** Whether the form may be submitted at all. */
export function canSubmitPassword(next: string, confirm: string): boolean {
  return (
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    passwordProblem(next, confirm) === null
  );
}
