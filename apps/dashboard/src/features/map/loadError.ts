// What the map says when its query fails. Until 2026-11-21 it printed the
// database's own words ("map query failed: canceling statement due to
// statement timeout"), which told the reader nothing they could act on. The
// one thing that helps is trying again: a timeout is the query running long
// on a busy database, and the next try usually lands.

/** PostgreSQL's statement_timeout, as the dashboard sees it through PostgREST. */
export function isTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /statement timeout/i.test(message) || /\b57014\b/.test(message);
}

export const TIMEOUT_MESSAGE = 'The map took too long to load. Refresh the page to try again.';
export const FAILED_MESSAGE = 'The map could not be loaded. Refresh the page to try again.';

/** The sentence shown over the map's error. Only a non-timeout failure keeps
 * the database's words, as a detail after the sentence, since those are the
 * ones worth reporting. */
export function loadErrorText(error: unknown): { message: string; detail: string | null } {
  if (isTimeout(error)) return { message: TIMEOUT_MESSAGE, detail: null };
  const detail = error instanceof Error && error.message !== '' ? error.message : null;
  return { message: FAILED_MESSAGE, detail };
}
