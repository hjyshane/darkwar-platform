import { TROOP_CLASSES } from '../../lib/troops';
import { CLASS_GLYPHS, Glyph } from './Glyphs';

/** Symbol = meaning, for everything a lineup chip carries.
 *
 * The mark itself stands in for its own name: a sample chip wearing the
 * border is a better label than the words "white border", and it is the
 * thing the reader is actually matching against the board. So each row is
 * the mark, an equals sign, and what it means — nothing spells out the mark
 * twice.
 *
 * The grades are not here. Their fill is a colour with a name the game gives
 * it, and the tooltip and the Grade column both say it — a swatch beside the
 * word 파랑 explains nothing a reader did not already have.
 *
 * Class rows come from TROOP_CLASSES and CLASS_GLYPHS rather than a
 * hand-written list, so a class added to either cannot appear on the board
 * and be missing from the key.
 */
function Entry({ mark, meaning }: { mark: React.ReactNode; meaning: string }) {
  return (
    <span className="legend-entry">
      {mark}
      <span aria-hidden="true">=</span>
      {meaning}
    </span>
  );
}

export function LineupLegend() {
  return (
    <p className="lineup-legend">
      {Object.entries(TROOP_CLASSES).map(([value, label]) => {
        const glyph = CLASS_GLYPHS[Number(value)];
        return glyph === undefined ? null : (
          <Entry
            key={value}
            mark={<Glyph label={label} name={glyph} spoken={false} />}
            meaning={label}
          />
        );
      })}
      <Entry mark={<span className="chip legend-chip chip-max-star" />} meaning="full star hero" />
      <Entry mark={<span className="chip legend-chip chip-weapon" />} meaning="exclusive weapon" />
      <Entry
        mark={<span className="chip legend-chip chip-weapon chip-weapon-awakened" />}
        meaning="exclusive weapon upgrade"
      />
      <Entry
        mark={<span className="chip legend-chip chip-synergy" />}
        meaning="combat faction effect"
      />
    </p>
  );
}
