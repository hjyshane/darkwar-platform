// Zod side of the §20.1 contract tests. The Python Pydantic models in
// services/collector and these schemas both load the SAME fixtures under
// protocol-fixtures/decoded/ — if either side drifts, its fixture test
// breaks. Strict about structure, passthrough for unpromoted fields (they
// belong to `raw`).

import { z } from 'zod';

export const observationSchema = z
  .object({
    observation_id: z.string().uuid(),
    collector_id: z.string().uuid(),
    source_command: z.string().min(1),
    captured_at: z.string().datetime({ offset: true }),
    collected_from_server_id: z.number().int(),
    payload: z.record(z.unknown()),
    schema_version: z.number().int().default(1),
  })
  .passthrough();

// Real al.rank shape (S14, extracted from darkwar_alrank.pcapng): the
// alliance id is the game's 32-hex string and members use the game's own
// field names. Unpromoted fields pass through — they belong to `raw`.
export const alRankMemberSchema = z
  .object({
    uid: z.string().regex(/^\d+$/),
    name: z.string().nullish(),
    rank: z.number().int().nullish(),
    power: z.number().int().nullish(),
    mainCityLv: z.number().int().nullish(),
    armyKill: z.number().int().nullish(),
    online: z.boolean().nullish(),
    offLineTime: z.number().int().nullish(),
    pointId: z.union([z.number().int(), z.string()]).nullish(),
    serverId: z.number().int().nullish(),
  })
  .passthrough();

export const alRankPayloadSchema = z
  .object({
    allianceId: z.string().min(1),
    list: z.array(alRankMemberSchema),
  })
  .passthrough();

// Real user.get.arena.info shape (S14-PR2, extracted from
// darkwar_arena_match.pcapng): rankArr is the Top100, startTime/endTime
// are the week bounds in epoch ms, fightServers the matchup.
export const arenaPayloadSchema = z
  .object({
    rankArr: z.array(
      z
        .object({
          uid: z.string().regex(/^\d+$/),
          rank: z.number().int(),
          name: z.string().nullish(),
          score: z.number().int().nullish(),
          power: z.number().int().nullish(),
          serverId: z.number().int().nullish(),
        })
        .passthrough(),
    ),
    startTime: z.number().int().nullish(),
    endTime: z.number().int().nullish(),
    fightServers: z.string().nullish(),
  })
  .passthrough();

// Real alliance.rank shape (S14-PR3): allianceRanking entries with the
// 32-hex alliance uid; leader is a display name, not a uid.
export const allianceRankPayloadSchema = z
  .object({
    allianceRanking: z.array(
      z
        .object({
          uid: z.string().regex(/^[0-9a-f]{32}$/),
          rank: z.number().int(),
          serverId: z.number().int().nullish(),
          alliancename: z.string().nullish(),
          abbr: z.string().nullish(),
          leader: z.string().nullish(),
          fightpower: z.number().int().nullish(),
          curMember: z.number().int().nullish(),
          maxMember: z.number().int().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

// Real get.al.info shape (S14-PR4): alliance detail card. leaderUid is the
// only confirmed place the leader appears as a uid rather than a name.
export const getAlInfoPayloadSchema = z
  .object({
    uid: z.string().regex(/^[0-9a-f]{32}$/),
    name: z.string().nullish(),
    abbr: z.string().nullish(),
    leaderUid: z.string().regex(/^\d+$/).nullish(),
    fightPower: z.number().int().nullish(),
    curMember: z.number().int().nullish(),
    createServer: z.number().int().nullish(),
  })
  .passthrough();

// Real server.rank shape (S14-PR5): cross-server player ranking. `lv` is
// the main-city level; the alliance is named but never identified.
export const serverRankPayloadSchema = z
  .object({
    serverRanking: z.array(
      z
        .object({
          uid: z.string().regex(/^\d+$/),
          rank: z.number().int(),
          name: z.string().nullish(),
          power: z.number().int().nullish(),
          lv: z.number().int().nullish(),
          serverId: z.number().int().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** The six components whose sum equals the profile's total power (FR-CORE-004). */
export const POWER_COMPONENTS = [
  'armyPower',
  'heroPower',
  'buildingPower',
  'sciencePower',
  'petPower',
  'modCarPower',
] as const;

// Real get.new.user.info shape (S14-PR6): full player profile.
export const getNewUserInfoPayloadSchema = z
  .object({
    uid: z.string().regex(/^\d+$/),
    name: z.string().nullish(),
    power: z.number().int().nullish(),
    serverId: z.number().int().nullish(),
    allianceId: z.string().nullish(),
    armyPower: z.number().int().nullish(),
    heroPower: z.number().int().nullish(),
    buildingPower: z.number().int().nullish(),
    sciencePower: z.number().int().nullish(),
    petPower: z.number().int().nullish(),
    modCarPower: z.number().int().nullish(),
  })
  .passthrough();

// Real get.user.info.multi shape (S14-PR7): public summaries. The only
// summary response carrying allianceId; `rank` is 0 everywhere observed.
export const getUserInfoMultiPayloadSchema = z
  .object({
    uids: z.array(
      z
        .object({
          uid: z.string().regex(/^\d+$/),
          name: z.string().nullish(),
          power: z.number().int().nullish(),
          mainBuildingLevel: z.number().int().nullish(),
          armyKill: z.number().int().nullish(),
          allianceId: z.string().nullish(),
          serverId: z.number().int().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type ObservationEnvelope = z.infer<typeof observationSchema>;
