// §20.1 Contract: the Zod schemas parse the SAME fixtures the Python
// Pydantic models parse. The malformed fixture must fail on both sides.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alRankPayloadSchema, arenaPayloadSchema, observationSchema } from '@dw/shared-types';
import { expect, test } from 'vitest';

function loadFixture(relative: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), '../../protocol-fixtures/decoded', relative), 'utf-8'),
  );
}

test('normal roster fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('al.rank/synthetic_roster_v1.json'));
  const payload = alRankPayloadSchema.parse(observation.payload);
  expect(payload.members).toHaveLength(20);
  expect(payload.alliance.external_id).toBe(987001);
  // Unpromoted fields pass through — they belong to raw.
  expect(payload.members[0]).toHaveProperty('decoration_id', 9001);
});

test('null/optional roster fixture satisfies the contract', () => {
  const observation = observationSchema.parse(
    loadFixture('al.rank/synthetic_roster_nulls_v1.json'),
  );
  const payload = alRankPayloadSchema.parse(observation.payload);
  expect(payload.members).toHaveLength(3);
  expect(payload.members[0]?.name).toBeUndefined();
  expect(payload.members[0]?.presence_redacted).toBe(false);
  expect(payload.members[2]?.presence_redacted).toBe(true);
});

test('malformed fixture is rejected, matching the Pydantic side', () => {
  const observation = observationSchema.parse(
    loadFixture('al.rank/synthetic_roster_malformed_v1.json'),
  );
  expect(alRankPayloadSchema.safeParse(observation.payload).success).toBe(false);
});

test('arena fixture satisfies the contract', () => {
  const observation = observationSchema.parse(
    loadFixture('user.get.arena.info/synthetic_week_v1.json'),
  );
  const payload = arenaPayloadSchema.parse(observation.payload);
  expect(payload.entries).toHaveLength(20);
  expect(payload.entries[0]?.rank).toBe(1);
});
