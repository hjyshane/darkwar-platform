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

test('real roster fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('al.rank/cbfw_roster_v1.json'));
  const payload = alRankPayloadSchema.parse(observation.payload);
  expect(payload.list).toHaveLength(93);
  expect(payload.allianceId).toMatch(/^[0-9a-f]{32}$/);
  expect(payload.list[0]?.uid).toBe('9000000001000580');
  // Unpromoted real fields pass through — they belong to raw.
  expect(payload.list[0]).toHaveProperty('alsign');
});

test('null/optional roster fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('al.rank/roster_nulls_v1.json'));
  const payload = alRankPayloadSchema.parse(observation.payload);
  expect(payload.list).toHaveLength(3);
  expect(payload.list[0]?.name).toBeUndefined();
  expect(payload.list[2]?.online).toBe(false);
});

test('redacted roster fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('al.rank/roster_redacted_v1.json'));
  const payload = alRankPayloadSchema.parse(observation.payload);
  expect(payload.list.every((m) => m.online === true && m.offLineTime === 0)).toBe(true);
});

test('malformed fixture is rejected, matching the Pydantic side', () => {
  const observation = observationSchema.parse(loadFixture('al.rank/roster_malformed_v1.json'));
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
