// `rewards`: what the event pays out, as chips (0310).

import { compact, isRecord, list, optStr, str } from './common';
import { type ItemRef, parseItemRef } from './itemRef';

export interface RewardItem {
  /** Null for a reward with no catalogue entry (a title, an emoji). */
  item_ref: ItemRef | null;
  label: string;
  /** skin | title | emoji | frame | item | ... — free text, shown as a tag. */
  kind: string;
  /** How it is earned, in the officer's words. */
  how: string;
  /** A game_icons key when the reward is art the catalogue does not list. */
  icon_ref?: string;
}

export interface RewardsPayload {
  items: RewardItem[];
}

function parseItem(value: unknown): RewardItem | null {
  if (!isRecord(value)) return null;
  const label = str(value.label);
  const kind = str(value.kind);
  if (label === null || kind === null) return null;
  const item_ref =
    value.item_ref === null || value.item_ref === undefined ? null : parseItemRef(value.item_ref);
  if (value.item_ref !== null && value.item_ref !== undefined && item_ref === null) return null;
  return compact({
    item_ref,
    label,
    kind,
    how: typeof value.how === 'string' ? value.how : '',
    icon_ref: optStr(value.icon_ref),
  });
}

export function parseRewards(value: unknown): RewardsPayload | null {
  if (!isRecord(value)) return null;
  const items = list(value.items, parseItem);
  return items === null ? null : { items };
}
