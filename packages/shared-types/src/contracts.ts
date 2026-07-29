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

export const alRankMemberSchema = z
  .object({
    game_uid: z.number().int(),
    name: z.string().nullish(),
    member_rank: z.number().int().nullish(),
    hq_level: z.number().int().nullish(),
    power: z.number().int().nullish(),
    kills: z.number().int().nullish(),
    online_state: z.string().nullish(),
    presence_redacted: z.boolean().default(false),
  })
  .passthrough();

export const alRankPayloadSchema = z
  .object({
    alliance: z
      .object({
        external_id: z.number().int(),
        server_id: z.number().int(),
        name: z.string().nullish(),
        code: z.string().nullish(),
      })
      .passthrough(),
    members: z.array(alRankMemberSchema),
  })
  .passthrough();

export const arenaPayloadSchema = z
  .object({
    server_id: z.number().int(),
    entries: z.array(
      z
        .object({
          game_uid: z.number().int(),
          rank: z.number().int(),
          name: z.string().nullish(),
          score: z.number().int().nullish(),
          defense_power: z.number().int().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type ObservationEnvelope = z.infer<typeof observationSchema>;
