/** One figure with the noun it belongs to.
 *
 * `value` is a STRING the caller has already formatted, not a number this
 * decides how to render. Whether 4,350,390 should read as "4.35M" depends on
 * what it counts, and the tile is the wrong place to guess.
 *
 * Proportional figures here, deliberately, while table cells use
 * tabular-nums: tabular gives every digit the width of a zero, which keeps a
 * column aligned but makes a large standalone number look gappy. Nothing
 * aligns vertically in a row of tiles.
 *
 * No colour carries meaning. The value wears the ordinary text token, so the
 * status palette stays reserved for things that actually have a state — the
 * freshness badge, which says "(stale)" in words as well.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
}: {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Already formatted, or null when we have not observed it. */
  value: string | null;
  /** What the figure is OF, when the label alone would overclaim. */
  note?: string;
  /** Exactly one tile per screen may be the hero. */
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'stat stat-hero' : 'stat'}>
      <div className="stat-label">{label}</div>
      {/* FR-UI-008: unknown is unknown. A dash, never a zero — an alliance
          that donated nothing and an alliance we have not looked at are not
          the same fact, and only one of them is worth acting on. */}
      <div className="stat-value">{value ?? '—'}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
