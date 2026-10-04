// How the planner names a level: the number, or the industry tier the game
// shows instead. Only Watchtower has tiers (0222): 35-39 is "Industry Lv.1",
// 40-44 Lv.2 ... 80 Lv.10, read here as i1..i10. Which levels carry a tier
// comes from game_upgrade_steps.tier, never from a rule in this file — the
// game may add tiers to other buildings, and then they appear by themselves.

/** subject -> level -> tier, for the subjects that have tiers at all. */
export type Tiers = ReadonlyMap<string, ReadonlyMap<number, number>>;

export interface LevelLabel {
  /** What to show large: "i1" or "34". */
  main: string;
  /** The plain level beside a tier, small: "35"; null for a plain level. */
  sub: string | null;
}

export function levelLabel(tiers: Tiers, subject: string, level: number): LevelLabel {
  const tier = tiers.get(subject)?.get(level);
  return tier === undefined
    ? { main: String(level), sub: null }
    : { main: `i${tier}`, sub: String(level) };
}

/** One string, for an <option>: "i1 · 35" or "34". */
export function levelText(tiers: Tiers, subject: string, level: number): string {
  const { main, sub } = levelLabel(tiers, subject, level);
  return sub === null ? main : `${main} · ${sub}`;
}

export function tiersFrom(
  rows: ReadonlyArray<{ subject_id: string; level: number; tier: number }>,
): Tiers {
  const out = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const levels = out.get(row.subject_id) ?? new Map<number, number>();
    levels.set(row.level, row.tier);
    out.set(row.subject_id, levels);
  }
  return out;
}
