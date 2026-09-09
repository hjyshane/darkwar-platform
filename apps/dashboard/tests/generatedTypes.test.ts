// The committed database types must be LOCAL-stack output.
//
// `supabase gen types typescript --local` and `--linked` do not produce the
// same file: a hosted project emits an `__InternalSupabase` block carrying
// `PostgrestVersion`, and a local stack does not. CI regenerates with
// `--local` and diffs, so a file generated against the hosted project fails
// that check with a complaint about a block nobody edited — which is how a day
// went once, and it was diagnosed wrong twice before this.
//
// `scripts/db-types.mjs` refuses to write such a file. This is the second half
// of that: it catches one that arrived some other way — a hand edit, a merge,
// or somebody running the CLI directly — and it catches it in `pnpm test`,
// which is in the pre-commit loop, rather than six minutes into the db job.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const types = readFileSync(
  join(__dirname, '..', '..', '..', 'packages', 'shared-types', 'src', 'database.types.ts'),
  'utf8',
);

test('the committed types are local-stack output, not linked', () => {
  // The DECLARATION, not the name. `Omit<Database, "__InternalSupabase">` is
  // ordinary boilerplate that `--local` emits too, so matching the bare name
  // would fail on a perfectly good file.
  expect(types).not.toContain('__InternalSupabase:');
  expect(types).not.toContain('PostgrestVersion');
});

test('and they are a types file at all', () => {
  // A `>` redirect used to truncate this file whenever the stack was down, so
  // "empty" is a state it has actually been in.
  expect(types).toContain('export type Database');
  expect(types.length).toBeGreaterThan(1000);
});
