import type { ReactNode } from 'react';
/** One figure with the noun it belongs to.
 *
 * `value` is ALREADY FORMATTED by the caller, not a number this decides how
 * to render. Whether 4,350,390 should read as "4.35M" depends on what it
 * counts, and the tile is the wrong place to guess.
 *
 * A node rather than a string only so a figure can also be a control — the
 * player page hangs its map on the coordinate, because the number is what
 * somebody is already looking at when they want to see where it is. That is
 * the exception; passing a raw number here is still the caller's bug.
 *
 * Proportional figures here, deliberately, while table cells use
 * tabular-nums: tabular gives every digit the width of a zero, which keeps a
 * column aligned but makes a large standalone number look gappy. Nothing
 * aligns vertically in a row of tiles.
 *
 * Colour is opt-in and only for a figure that has a DIRECTION. A level — power,
 * kills, HQ — has no better or worse, so colouring it would invent a state the
 * figure does not have; those tiles keep the ordinary text token and the status
 * palette stays for things that really have one, like the freshness badge.
 *
 * A delta is the exception: it is already signed, and the sign is the point. So
 * `tone` exists, and a caller passes it only when the value it formatted was a
 * change. The colour reinforces a `+` or `−` that is on screen either way,
 * which is why a reader who cannot separate the two hues loses nothing.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone,
}: {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Already formatted, or null when we have not observed it. */
  value: ReactNode;
  /** What the figure is OF, when the label alone would overclaim. */
  note?: string;
  /** Exactly one tile per screen may be the hero. */
  hero?: boolean;
  /** Only for signed changes. `flat` is deliberately the ordinary colour: no
   * change is not a third state deserving a hue, it is the absence of one. */
  tone?: 'up' | 'down' | 'flat';
}) {
  const toneClass = tone === 'up' ? ' growth-up' : tone === 'down' ? ' growth-down' : '';
  return (
    <div className={hero ? 'stat stat-hero' : 'stat'}>
      <div className="stat-label">{label}</div>
      {/* FR-UI-008: unknown is unknown. A dash, never a zero — an alliance
          that donated nothing and an alliance we have not looked at are not
          the same fact, and only one of them is worth acting on. */}
      <div className={`stat-value${toneClass}`}>{value ?? '—'}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
