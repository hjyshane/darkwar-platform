// §20.1 Contract: the Zod schemas parse the SAME fixtures the Python
// Pydantic models parse. The malformed fixture must fail on both sides.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  POWER_COMPONENTS,
  alRankPayloadSchema,
  allianceRankPayloadSchema,
  arenaPayloadSchema,
  getAlInfoPayloadSchema,
  getNewUserInfoPayloadSchema,
  getUserInfoMultiPayloadSchema,
  observationSchema,
  serverRankPayloadSchema,
} from '@dw/shared-types';
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
  expect(payload.list[0]?.uid).toBe('9473022442000580');
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
    loadFixture('user.get.arena.info/top100_580v582_v1.json'),
  );
  const payload = arenaPayloadSchema.parse(observation.payload);
  expect(payload.rankArr).toHaveLength(100);
  expect(payload.rankArr[0]?.rank).toBe(1);
  expect(payload.fightServers).toBe('580;582');
  // startTime is the game's own Monday 02:00 UTC week bound.
  expect(payload.startTime).toBe(Date.parse('2026-07-27T02:00:00Z'));
});

test('arena malformed fixture is rejected', () => {
  const observation = observationSchema.parse(
    loadFixture('user.get.arena.info/arena_malformed_v1.json'),
  );
  expect(arenaPayloadSchema.safeParse(observation.payload).success).toBe(false);
});

test('alliance ranking fixtures satisfy the contract', () => {
  const local = observationSchema.parse(loadFixture('alliance.rank/local_580_v1.json'));
  const cross = observationSchema.parse(loadFixture('alliance.rank/cross_group_v1.json'));
  expect(allianceRankPayloadSchema.parse(local.payload).allianceRanking).toHaveLength(41);
  expect(allianceRankPayloadSchema.parse(cross.payload).allianceRanking).toHaveLength(100);
  // The local #1 is the same alliance as the al.rank roster fixture.
  const roster = observationSchema.parse(loadFixture('al.rank/cbfw_roster_v1.json'));
  expect(allianceRankPayloadSchema.parse(local.payload).allianceRanking[0]?.uid).toBe(
    roster.payload.allianceId,
  );
});

test('alliance ranking malformed fixture is rejected', () => {
  const observation = observationSchema.parse(
    loadFixture('alliance.rank/ranking_malformed_v1.json'),
  );
  expect(allianceRankPayloadSchema.safeParse(observation.payload).success).toBe(false);
});

test('alliance detail fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('get.al.info/love_580_v1.json'));
  const payload = getAlInfoPayloadSchema.parse(observation.payload);
  expect(payload.leaderUid).toBe('9734238058000580');
  expect(payload.curMember).toBe(98);
});

test('cross-server player ranking fixture satisfies the contract', () => {
  const observation = observationSchema.parse(loadFixture('server.rank/group_top150_v1.json'));
  const payload = serverRankPayloadSchema.parse(observation.payload);
  expect(payload.serverRanking).toHaveLength(150);
  const servers = new Set(payload.serverRanking.map((e) => e.serverId));
  expect([...servers].sort()).toEqual([577, 578, 579, 580, 581, 582, 583, 584]);
});

test('player profile six power components sum to the total', () => {
  const observation = observationSchema.parse(loadFixture('get.new.user.info/profile_578_v1.json'));
  const payload = getNewUserInfoPayloadSchema.parse(observation.payload);
  const sum = POWER_COMPONENTS.reduce((total, key) => total + (payload[key] ?? 0), 0);
  expect(sum).toBe(payload.power);
});

test('public summary fixture satisfies the contract and matches the profile', () => {
  const summary = getUserInfoMultiPayloadSchema.parse(
    observationSchema.parse(loadFixture('get.user.info.multi/summary_578_v1.json')).payload,
  );
  const profile = getNewUserInfoPayloadSchema.parse(
    observationSchema.parse(loadFixture('get.new.user.info/profile_578_v1.json')).payload,
  );
  expect(summary.uids[0]?.uid).toBe(profile.uid);
  expect(summary.uids[0]?.allianceId).toBe(profile.allianceId);
});
