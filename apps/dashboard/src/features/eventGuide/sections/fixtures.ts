// One fixture per section kind, from the Halloween guide in the spec's
// screenshots (docs/superpowers/specs/2026-11-08-event-guide-framework-design.md).
//
// The numbers that matter for the derivations: the orange hero shard
// (item 253042) scores 750 on day 2 and 500 on days 5 and 6, so its best day
// is 2; wood (resource 25) scores 10 on days 1 and 3, a tie; the gold coin
// (item 200036) appears on day 1 only, so it has no best day.

import type { NotesPayload } from './notes';
import type { PointTablePayload } from './pointTable';
import type { PrepPayload } from './prep';
import type { RewardsPayload } from './rewards';
import type { SourcesPayload } from './sources';
import type { StagesPayload } from './stages';

export const SHARD = { kind: 'item', id: '253042' } as const;
export const COIN = { kind: 'item', id: '200036' } as const;
export const WOOD = { kind: 'resource', id: '25' } as const;
export const CANDY = { kind: 'item', id: '300100' } as const;
export const AMMO = { kind: 'item', id: '300101' } as const;

export const HALLOWEEN_REWARDS: RewardsPayload = {
  items: [
    { item_ref: null, label: 'Pumpkin Knight skin', kind: 'skin', how: 'Reach stage 30' },
    { item_ref: null, label: 'Night Stalker', kind: 'title', how: 'Top 10 on the server' },
    { item_ref: null, label: 'Jack-o-lantern', kind: 'emoji', how: '2,000 candy' },
    { item_ref: null, label: 'Cobweb frame', kind: 'frame', how: 'Top 100 on the server' },
    { item_ref: SHARD, label: 'Orange hero shard', kind: 'item', how: 'Stage drops' },
  ],
};

export const HALLOWEEN_STAGES: StagesPayload = {
  groups: [
    {
      label: 'Stages 1-10',
      stages: [
        { n: 1, drops: [{ item_ref: CANDY, qty: 50 }] },
        {
          n: 5,
          drops: [
            { item_ref: CANDY, qty: 100 },
            { item_ref: SHARD, qty: 1 },
          ],
        },
        { n: 10, drops: [{ item_ref: SHARD, qty: 3 }] },
      ],
    },
    {
      label: 'Stages 11-20',
      stages: [
        { n: 15, drops: [{ item_ref: SHARD, qty: 5 }] },
        {
          n: 20,
          drops: [
            { item_ref: SHARD, qty: 10 },
            { item_ref: COIN, qty: 500 },
          ],
        },
      ],
    },
  ],
  totals: [
    { item_ref: CANDY, qty: 150 },
    { item_ref: SHARD, qty: 19 },
    { item_ref: COIN, qty: 500 },
  ],
};

export const HALLOWEEN_POINT_TABLES: PointTablePayload[] = [
  {
    day: 1,
    theme: 'Gathering',
    rows: [
      { action: 'Gather 1,000 wood', points: 10, item_ref: WOOD, per: 1000 },
      { action: 'Spend 1 gold coin', points: 2, item_ref: COIN, per: 1 },
    ],
  },
  {
    day: 2,
    theme: 'Hero Day',
    rows: [
      {
        action: 'Consume 1 orange hero shard',
        points: 750,
        item_ref: SHARD,
        per: 1,
        best_day_hint: 'best',
      },
    ],
  },
  {
    day: 3,
    theme: 'Building',
    rows: [{ action: 'Gather 1,000 wood', points: 10, item_ref: WOOD, per: 1000 }],
  },
  { day: 4, theme: 'Rally', rows: [{ action: 'Defeat 1 zombie', points: 4 }] },
  {
    day: 5,
    theme: 'Power Up',
    rows: [{ action: 'Consume 1 orange hero shard', points: 500, item_ref: SHARD, per: 1 }],
  },
  {
    day: 6,
    theme: 'Power Up',
    rows: [{ action: 'Consume 1 orange hero shard', points: 500, item_ref: SHARD, per: 1 }],
  },
];

export const HALLOWEEN_PREP: PrepPayload = {
  items: [
    { item_ref: SHARD, unit: 1, per_unit_points: 750, cap: 412, day: 2 },
    { item_ref: WOOD, unit: 1000, per_unit_points: 10, day: 1 },
    { item_ref: AMMO, unit: 1, per_unit_shots: 1, cap: 300 },
  ],
};

export const HALLOWEEN_SOURCES: SourcesPayload = {
  rows: [
    { source: 'Daily quests', rate: '5 candy per quest', cap: 50 },
    { source: 'Gathering', rate: '1 candy per 10 minutes', cap: 100 },
    { source: 'Login', rate: '20 candy', cap: 20 },
    { source: 'Shop pack', rate: '200 candy', cap: null },
  ],
  total_cap: 170,
  note: 'Free candy caps at 170 a day; the pack is extra.',
};

export const HALLOWEEN_NOTES: NotesPayload = {
  text: 'Hold shards until day 2. Spend candy before the event ends: it does not carry over.',
  text_ko: null,
};
