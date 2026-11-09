// `stages`: the event's stage ladder with per-stage drops and totals (0310).

import { intIn, isRecord, list, num, str } from './common';
import { type ItemRef, parseItemRef } from './itemRef';

export interface Drop {
  item_ref: ItemRef;
  qty: number;
}

export interface Stage {
  n: number;
  drops: Drop[];
}

export interface StageGroup {
  label: string;
  stages: Stage[];
}

export interface StagesPayload {
  groups: StageGroup[];
  totals: Drop[];
}

export function parseDrop(value: unknown): Drop | null {
  if (!isRecord(value)) return null;
  const item_ref = parseItemRef(value.item_ref);
  const qty = num(value.qty);
  return item_ref === null || qty === null ? null : { item_ref, qty };
}

function parseStage(value: unknown): Stage | null {
  if (!isRecord(value)) return null;
  const n = intIn(value.n, 0, 10_000);
  const drops = list(value.drops, parseDrop);
  return n === null || drops === null ? null : { n, drops };
}

function parseGroup(value: unknown): StageGroup | null {
  if (!isRecord(value)) return null;
  const label = str(value.label);
  const stages = list(value.stages, parseStage);
  return label === null || stages === null ? null : { label, stages };
}

export function parseStages(value: unknown): StagesPayload | null {
  if (!isRecord(value)) return null;
  const groups = list(value.groups, parseGroup);
  const totals = list(value.totals ?? [], parseDrop);
  return groups === null || totals === null ? null : { groups, totals };
}
