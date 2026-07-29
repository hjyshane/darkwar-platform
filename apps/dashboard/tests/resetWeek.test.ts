// Consumes the shared vectors — the same file the SQL and Python tests pin.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { resetWeekStart } from '../src/lib/resetWeek';

interface Vector {
  name: string;
  input: string;
  expected: string;
}

// vitest runs with cwd = apps/dashboard (pnpm runs scripts in the package).
const { vectors } = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../protocol-fixtures/reset-week/vectors.json'), 'utf-8'),
) as { vectors: Vector[] };

test.each(vectors)('$name', ({ input, expected }) => {
  expect(resetWeekStart(new Date(input)).toISOString()).toBe(new Date(expected).toISOString());
});
