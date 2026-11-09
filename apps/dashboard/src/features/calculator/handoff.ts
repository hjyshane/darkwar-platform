// "Load into my plan": the calculator hands one target to the planner through
// the address — `#/planner?target=building:409000:30` — which the planner
// reads once on mount and then strips, saving nothing until its own Save.
//
// Only kinds whose planner subject is account-independent travel this way.
// Hero gear and pets key their subjects by the account's own gear or pet, and
// the planner has no chip kind, so those have no hand-off. The calculator's
// `from` is a reference choice, not a claim about the account: the planner
// takes the account's ACTUAL current level as `from` and the calculator's `to`
// as the target. No React here; useHandoff.ts is the hook.

import type { Account } from '../planner/accounts';
import type { Kind } from '../planner/plan';
import type { Target } from '../planner/targets';

export const HANDOFF_KINDS = [
  'building',
  'research',
  'exclusive',
  'vehicle',
  'vehicle_part',
] as const;

export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export interface Handoff {
  kind: HandoffKind;
  subject: string;
  to: number;
}

const PLANNER_HASH = '#/planner';
const PARAM = 'target';
const SUBJECT = /^[A-Za-z0-9:_]{1,40}$/;

export function isHandoffKind(kind: string): kind is HandoffKind {
  return (HANDOFF_KINDS as ReadonlyArray<string>).includes(kind);
}

/** Whether the calculator offers "Load into my plan" for a kind. */
export function canHandOff(kind: Kind | string): boolean {
  return isHandoffKind(kind);
}

/** The planner address that carries one target. */
export function plannerHandoffHash(handoff: Handoff): string {
  const params = new URLSearchParams();
  params.set(PARAM, `${handoff.kind}:${handoff.subject}:${handoff.to}`);
  return `${PLANNER_HASH}?${params.toString()}`;
}

function splitQuery(hash: string): { path: string; params: URLSearchParams } {
  const at = hash.indexOf('?');
  return at < 0
    ? { path: hash, params: new URLSearchParams() }
    : { path: hash.slice(0, at), params: new URLSearchParams(hash.slice(at + 1)) };
}

/** The target a planner address carries, or null when it carries none or
 * one the planner cannot take (unknown kind, bad subject, no level). */
export function readHandoff(hash: string): Handoff | null {
  const { path, params } = splitQuery(hash);
  if (path !== PLANNER_HASH && !path.startsWith(`${PLANNER_HASH}/`)) return null;
  const raw = params.get(PARAM);
  if (raw === null) return null;
  // Every hand-off subject is a plain id (type, science, hero, slot, "0"), so
  // the value is exactly kind:subject:level.
  const parts = raw.split(':');
  if (parts.length !== 3) return null;
  const [kind, subject, level] = parts as [string, string, string];
  const to = Number(level);
  if (!isHandoffKind(kind) || !SUBJECT.test(subject) || !Number.isInteger(to) || to < 1) {
    return null;
  }
  return { kind, subject, to };
}

/** The same address without the target, so a reload does not add it twice. */
export function stripHandoff(hash: string): string {
  const { path, params } = splitQuery(hash);
  params.delete(PARAM);
  const rest = params.toString();
  return rest === '' ? path : `${path}?${rest}`;
}

/** The level the account actually has for the thing handed off. */
export function currentLevel(account: Account, handoff: Handoff): number {
  switch (handoff.kind) {
    case 'building':
      return account.buildings[handoff.subject] ?? 0;
    case 'research':
      return account.science[handoff.subject] ?? 0;
    case 'exclusive':
      return account.heroExclusives[handoff.subject] ?? 0;
    case 'vehicle':
      return account.vehicle.level ?? 0;
    case 'vehicle_part':
      return account.vehicleParts[handoff.subject] ?? 0;
  }
}

/** The planner target for a hand-off, from the account's own level up to the
 * calculator's `to`; null when the account is already there or past it. */
export function handoffTarget(handoff: Handoff, account: Account, name: string): Target | null {
  const from = currentLevel(account, handoff);
  if (handoff.to <= from) return null;
  return { kind: handoff.kind, subject: handoff.subject, name, from, to: handoff.to };
}
