// Saved plans (0341): what the reader chose to raise, under a name, so the
// planner can be reopened where it was left and the list read from My account.
//
// A plan holds the CHOICES — targets, the buff typed on top, whether
// prerequisites count — and not the account's state: opened later, it is
// costed against the account as it is then. Rows are the author's own; RLS
// decides that, nothing here does.

import type { Json } from '@dw/shared-types';
import { type Translate, english } from '../../lib/i18n/core';
import { supabase } from '../../lib/supabase';
import type { Buffs, Kind } from './plan';
import { type Target, targetKey } from './targets';

export interface SavedPlan {
  planId: string;
  name: string;
  /** The account it was made for; null for a plan made with no character. */
  playerId: string | null;
  /** That account's name when the plan was saved. */
  accountName: string;
  targets: Target[];
  extra: Buffs;
  withPrereqs: boolean;
  updatedAt: string;
}

export const NO_EXTRA: Buffs = { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 };

const KINDS: ReadonlySet<string> = new Set<Kind>([
  'building',
  'research',
  'hero',
  'hero_gear',
  'exclusive',
  'vehicle',
  'vehicle_part',
  'pet',
  'pet_break',
  'chip',
]);

const level = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** The targets a stored row holds, with anything that is not a target left
 * out. The column is jsonb the page wrote, but a row can be older than the
 * page reading it, so nothing is trusted to have the shape. */
export function targetsFromJson(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  const out: Target[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const from = level(row.from);
    const to = level(row.to);
    if (
      typeof row.kind !== 'string' ||
      !KINDS.has(row.kind) ||
      typeof row.subject !== 'string' ||
      typeof row.name !== 'string' ||
      from === null ||
      to === null
    ) {
      continue;
    }
    const stageFrom = level(row.stageFrom);
    const stageTo = level(row.stageTo);
    out.push({
      kind: row.kind as Kind,
      subject: row.subject,
      name: row.name,
      from,
      to,
      ...(stageFrom === null ? {} : { stageFrom }),
      ...(stageTo === null ? {} : { stageTo }),
    });
  }
  return out;
}

export function buffsFromJson(value: unknown): Buffs {
  const row = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof Buffs) => (typeof row[key] === 'number' ? (row[key] as number) : 0);
  return {
    constructionSpeed: pick('constructionSpeed'),
    researchSpeed: pick('researchSpeed'),
    costReduction: pick('costReduction'),
  };
}

/** The page's map of targets, keyed the way the pickers key it. */
export function targetMap(targets: readonly Target[]): Map<string, Target> {
  return new Map(targets.map((t) => [targetKey(t.kind, t.subject), t]));
}

/** "Headquarters 30 → 31", with a gear's stages when it climbs them. `shown`
 * turns a level into what the game calls it (a building's tier). */
export function targetText(
  target: Target,
  shown: (target: Target, level: number) => string,
  t: Translate = english,
): string {
  const stages =
    target.kind === 'hero_gear' && (target.stageTo ?? 0) > (target.stageFrom ?? 0)
      ? ` · ${t('stage {from} → {to}', { from: String(target.stageFrom), to: String(target.stageTo) })}`
      : '';
  return `${target.name} ${shown(target, target.from)} → ${shown(target, target.to)}${stages}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The plan a planner address asks for: `#/planner?plan=<uuid>`. */
export function planIdFromHash(hash: string): string | null {
  const at = hash.indexOf('?');
  if (at < 0) return null;
  const id = new URLSearchParams(hash.slice(at + 1)).get('plan');
  return id !== null && UUID.test(id) ? id : null;
}

export function planHash(planId: string): string {
  return `#/planner?plan=${planId}`;
}

interface Row {
  plan_id: string;
  name: string;
  player_id: string | null;
  account_name: string;
  targets: Json;
  extra_buffs: Json;
  with_prereqs: boolean;
  updated_at: string;
}

const COLUMNS =
  'plan_id, name, player_id, account_name, targets, extra_buffs, with_prereqs, updated_at';

function fromRow(row: Row): SavedPlan {
  return {
    planId: row.plan_id,
    name: row.name,
    playerId: row.player_id,
    accountName: row.account_name,
    targets: targetsFromJson(row.targets),
    extra: buffsFromJson(row.extra_buffs),
    withPrereqs: row.with_prereqs,
    updatedAt: row.updated_at,
  };
}

/** The reader's own plans, newest first. */
export async function fetchPlans(): Promise<SavedPlan[]> {
  const { data, error } = await supabase
    .from('planner_plans')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export interface PlanDraft {
  /** Set to write over a saved plan; absent to save a new one. */
  planId?: string | null;
  name: string;
  playerId: string | null;
  accountName: string;
  targets: readonly Target[];
  extra: Buffs;
  withPrereqs: boolean;
}

/** Save a plan, new or over the one it was opened from. */
export async function savePlan(draft: PlanDraft): Promise<SavedPlan> {
  const values = {
    name: draft.name.trim(),
    // The scratch account a community reader plans with is no character.
    player_id: draft.playerId !== null && UUID.test(draft.playerId) ? draft.playerId : null,
    account_name: draft.accountName.slice(0, 80),
    targets: draft.targets as unknown as Json,
    extra_buffs: { ...draft.extra } as Json,
    with_prereqs: draft.withPrereqs,
  };
  const query =
    draft.planId != null
      ? supabase.from('planner_plans').update(values).eq('plan_id', draft.planId)
      : supabase.from('planner_plans').insert(values);
  const { data, error } = await query.select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export async function deletePlan(planId: string): Promise<void> {
  const { error } = await supabase.from('planner_plans').delete().eq('plan_id', planId);
  if (error) throw new Error(error.message);
}
