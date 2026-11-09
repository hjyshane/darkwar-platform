// `item_ref`: how a section names a thing in the game (0309).
//
// {kind, id}, resolved through the catalogue at render time, so a renamed
// item renames everywhere and the payload never carries a label that can go
// stale. Kinds are the ones the catalogue and game_icon_refs know.

import { isRecord } from './common';

export const ITEM_REF_KINDS = ['item', 'resource', 'hero', 'gear', 'exclusive', 'pet'] as const;
export type ItemRefKind = (typeof ITEM_REF_KINDS)[number];

export interface ItemRef {
  kind: ItemRefKind;
  id: string;
}

export function parseItemRef(value: unknown): ItemRef | null {
  if (!isRecord(value)) return null;
  const { kind, id } = value;
  if (typeof kind !== 'string' || !(ITEM_REF_KINDS as readonly string[]).includes(kind)) {
    return null;
  }
  if (typeof id === 'string' && id.length > 0) return { kind: kind as ItemRefKind, id };
  if (typeof id === 'number' && Number.isInteger(id))
    return { kind: kind as ItemRefKind, id: String(id) };
  return null;
}

/** `item:253042` — resource 25 and item 25 are different things (0209). */
export function itemRefKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Names and icons by `itemRefKey`. Built once per page from the catalogue
 * tables; sections resolve against it. */
export interface ItemCatalogue {
  names: Map<string, string>;
  icons: Map<string, string>;
}

export interface CatalogueInput {
  items?: readonly { item_id: string; name: string | null }[];
  resources?: readonly { resource_id: number; name: string | null }[];
  heroes?: readonly { hero_id: number; name: string | null }[];
  /** game_icon_refs rows; `kind` there is the same word as the ref kind. */
  iconRefs?: readonly { kind: string; ref_id: string; icon_key: string }[];
}

export function catalogueFrom(input: CatalogueInput): ItemCatalogue {
  const names = new Map<string, string>();
  const icons = new Map<string, string>();
  for (const row of input.items ?? []) {
    if (row.name) names.set(`item:${row.item_id}`, row.name);
  }
  for (const row of input.resources ?? []) {
    if (row.name) names.set(`resource:${row.resource_id}`, row.name);
  }
  for (const row of input.heroes ?? []) {
    if (row.name) names.set(`hero:${row.hero_id}`, row.name);
  }
  for (const row of input.iconRefs ?? []) {
    icons.set(`${row.kind}:${row.ref_id}`, row.icon_key);
  }
  return { names, icons };
}

export interface ResolvedItem {
  ref: ItemRef;
  label: string;
  /** A game_icons key, or null when no sprite is known. The icon itself is
   * members-only (0232); the caller decides whether it may be shown. */
  iconKey: string | null;
}

export function resolveItemRef(ref: ItemRef, catalogue: ItemCatalogue): ResolvedItem {
  const key = itemRefKey(ref);
  return {
    ref,
    label: catalogue.names.get(key) ?? `${ref.kind} ${ref.id}`,
    iconKey: catalogue.icons.get(key) ?? null,
  };
}
