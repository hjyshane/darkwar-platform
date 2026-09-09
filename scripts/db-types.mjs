// Regenerate packages/shared-types/src/database.types.ts, from the LOCAL stack
// and only from the local stack.
//
// WHY THIS IS A SCRIPT AND NOT A `>` REDIRECT.
//
//   `supabase gen types typescript --local > types.ts` truncates the file
//   BEFORE the command runs. When the local stack is down — which on Windows
//   means Docker Desktop is simply not started — the CLI fails and the shell
//   has already emptied the committed types. The operator is then looking at
//   a broken working tree and a command that "did nothing", and the obvious
//   way out is `--linked`, which is the thing this file exists to prevent.
//
// WHY `--linked` IS NOT AN OPTION, even though it needs no Docker.
//
//   The two commands do not produce the same file. A hosted project emits an
//   `__InternalSupabase` block carrying `PostgrestVersion`; a local stack does
//   not. CI checks the committed file against `--local` output, so a file
//   regenerated against the hosted project fails that check with a diff about
//   a block nobody edited — which is exactly how a day went once.
//
//   So the fix is not to teach CI about both. It is to have one command, make
//   it fail safely when it cannot run, and refuse to write output of the wrong
//   shape at all.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'shared-types',
  'src',
  'database.types.ts',
);

/** Markers a hosted (`--linked`) generation carries and a local one does not. */
const LINKED_ONLY = ['__InternalSupabase:', 'PostgrestVersion'];

function fail(message) {
  console.error(`\ndb:types — ${message}\n`);
  process.exit(1);
}

let generated;
try {
  generated = execFileSync(
    'supabase',
    ['gen', 'types', 'typescript', '--local'],
    // The types file is ~6,000 lines; the default 1MB buffer is not enough
    // headroom to rely on as the schema grows.
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  const detail = (error.stderr ?? error.message ?? '').toString().trim();
  fail(
    [
      'could not read the schema from the local stack.',
      '',
      detail === '' ? '' : `  ${detail.split('\n').join('\n  ')}`,
      '',
      'The local stack has to be up:',
      '    supabase start',
      '',
      'Do NOT reach for `--linked` instead. It emits an __InternalSupabase',
      'block that `--local` does not, and CI checks against `--local`.',
      '',
      'Nothing was written, so the committed types are untouched.',
    ].join('\n'),
  );
}

// Written only after both checks pass, so a bad run leaves the old file alone.
if (!generated.includes('export type Database')) {
  fail('the generator produced something that is not a types file. Nothing written.');
}
const found = LINKED_ONLY.filter((marker) => generated.includes(marker));
if (found.length > 0) {
  fail(
    `the output carries ${found.join(' and ')}, which only a hosted project emits.
That is \`--linked\` output. Nothing written.`,
  );
}

writeFileSync(TARGET, generated);
process.stdout.write(`db:types — wrote ${generated.split('\n').length} lines to ${TARGET}\n`);
