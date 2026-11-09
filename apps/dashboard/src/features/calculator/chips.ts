// Vehicle chips as the calculator shows them (0309). No React, no queries.
//
// The importer flattens a chip's (star, sub-step) to one level per step:
// level = star x 10 + sub-step reached, 1..100, so "0★ 4/10 → 0★ 5/10" is the
// step to level 5 and "0★ 9/10 → 1★ 0/10" the step to level 10. The same
// arithmetic lives in gamedata/catalog.py (chip_label); keep them together.

/** Sub-steps per star, as the game draws them ("4/10"). */
export const CHIP_SUBSTEPS = 10;
/** The last state a chip reaches: 10★ 0/10. */
export const CHIP_MAX_LEVEL = 100;

/** The qualities that upgrade, by the client's quality number = the step
 * subject id. Green (2) and blue (3) have no star-up track. */
export const CHIP_QUALITIES: Readonly<Record<string, string>> = {
  '4': 'Purple',
  '5': 'Orange',
};

/** A chip's state at a flat level: 5 → "0★ 5/10", 10 → "1★ 0/10", 100 → "10★ 0/10". */
export function chipLabel(level: number): string {
  const clamped = Math.max(0, Math.min(CHIP_MAX_LEVEL, Math.trunc(level)));
  return `${Math.floor(clamped / CHIP_SUBSTEPS)}★ ${clamped % CHIP_SUBSTEPS}/${CHIP_SUBSTEPS}`;
}

/** The flat level of a (star, sub-step) state. */
export function chipLevel(star: number, subStep: number): number {
  return star * CHIP_SUBSTEPS + subStep;
}

/** What the step to `level` reads as in a step table: "0★ 4/10 → 0★ 5/10". */
export function chipStepName(level: number): string {
  return `${chipLabel(level - 1)} → ${chipLabel(level)}`;
}

/** "Purple chip" for subject "4"; the id itself for a quality we do not know. */
export function chipSubjectName(subject: string): string {
  const quality = CHIP_QUALITIES[subject];
  return quality ? `${quality} chip` : `Chip quality ${subject}`;
}

/** The counter ids chip steps spend (gamedata/catalog.py CHIP_EXP, CHIP_DUPLICATE). */
export const CHIP_EXP = 'chip_exp';
export const CHIP_DUPLICATE_PREFIX = 'chip_duplicate:';

/** A reader-facing name for a counter: "Star-up EXP", "Purple chip duplicates". */
export function counterName(id: string): string {
  if (id === CHIP_EXP) return 'Star-up EXP';
  if (id.startsWith(CHIP_DUPLICATE_PREFIX)) {
    return `${chipSubjectName(id.slice(CHIP_DUPLICATE_PREFIX.length))} duplicates`;
  }
  return id;
}
