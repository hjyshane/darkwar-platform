import type { ReactNode } from 'react';
import { Cell, type CellTone } from './console/Cell';

/** One figure with the noun it belongs to.
 *
 * Since the console restyle this is a thin wrapper over `console/Cell`: it
 * keeps the props and the `.stat*` class hooks its 100-odd call sites and
 * the strip stylesheet rely on, and renders the console cell underneath.
 * New code uses `Cell` directly.
 *
 * `value` is ALREADY FORMATTED by the caller, not a number this decides how
 * to render. Whether 4,350,390 should read as "4.35M" depends on what it
 * counts, and the tile is the wrong place to guess. A node rather than a
 * string only so a figure can also be a control; passing a raw number here
 * is still the caller's bug.
 *
 * Colour is opt-in and only for a figure that has a DIRECTION. A level has
 * no better or worse, so a tile keeps the ordinary text colour; `tone` is
 * for a signed change, where the colour reinforces a `+` or `−` already on
 * screen. `flat` is deliberately the ordinary colour: no change is not a
 * third state deserving a hue.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone,
  spark,
}: {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Already formatted, or null when we have not observed it. */
  value: ReactNode;
  /** What the figure is OF, when the label alone would overclaim. */
  note?: string;
  /** Exactly one tile per screen may be the hero. */
  hero?: boolean;
  /** Only for signed changes. */
  tone?: 'up' | 'down' | 'flat';
  /** A trend line under the figure. Decoration, hidden from assistive tech. */
  spark?: ReactNode;
}) {
  const direction: CellTone | undefined = tone === 'up' || tone === 'down' ? tone : undefined;
  const growth = direction === 'up' ? ' growth-up' : direction === 'down' ? ' growth-down' : '';
  return (
    <Cell
      classNames={{
        root: hero ? 'stat stat-hero' : 'stat',
        label: 'stat-label',
        value: `stat-value${growth}`,
        spark: 'stat-spark',
        note: 'stat-note',
      }}
      hero={hero}
      label={label}
      note={note}
      spark={spark}
      tone={direction}
      value={value}
    />
  );
}
