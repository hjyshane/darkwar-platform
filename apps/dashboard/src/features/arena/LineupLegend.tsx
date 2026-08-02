import { TROOP_CLASSES } from '../../lib/troops';
import { CLASS_GLYPHS, Glyph } from './Glyphs';

/** Which symbol is which class.
 *
 * The chip used to carry a letter and now carries the game's own glyph, so
 * this is the one mapping a reader cannot get from the screen itself. The
 * other marks a chip carries — the fill, the border, the dots, the ring —
 * are all named in its tooltip and in the row it expands to, so spelling
 * them out here as well was four lines of text explaining what one hover
 * already answers.
 *
 * Rendered from TROOP_CLASSES and CLASS_GLYPHS rather than a hand-written
 * list, so a class added to either cannot appear on the board and be missing
 * from the key.
 */
export function LineupLegend() {
  return (
    <p className="lineup-legend">
      {Object.entries(TROOP_CLASSES).map(([value, label]) => {
        const glyph = CLASS_GLYPHS[Number(value)];
        return glyph === undefined ? null : (
          <span key={value}>
            <Glyph label={label} name={glyph} spoken={false} />
            {label}
          </span>
        );
      })}
    </p>
  );
}
