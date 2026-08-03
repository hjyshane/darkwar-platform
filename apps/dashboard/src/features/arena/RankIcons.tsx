/** Stars and pentagons, drawn rather than counted out in numbers.
 *
 * A rank in this game is two numbers that only mean anything together — four
 * stars and two steps toward the fifth — and printing them as "4" and "2" in
 * separate columns made the reader do the joining. Five outlines with four
 * filled and the next one two-fifths full says it in one glance, which is
 * also how the game itself says it.
 *
 * The step divides a shape into fifths because that is what the payload
 * does: hero stage runs 0-4, and a weapon takes five levels to a step.
 *
 * Inline SVG, no sprite and no icon font: these render inside a table cell
 * that is already scrolling horizontally, and a font would bring a network
 * request the CSP for this app has no reason to allow.
 */

const STAR =
  'M10 1.5 12.472 7.09 18.5 7.77 14 11.87 15.236 17.8 10 14.8 4.764 17.8 6 11.87 1.5 7.77 8.528 7.09Z';
const PENTAGON = 'M10 1.5 18.5 7.68 15.253 17.68 4.747 17.68 1.5 7.68Z';

/** Where to cut a shape so the filled part is n fifths of its AREA.
 *
 * Filling n/5 of the width is not filling n/5 of the shape, and the gap is
 * not small: a star cut at 3/5 of its width comes out 67% full, and a
 * pentagon cut at 2/5 comes out 36% — which is what "0.4 looks half full"
 * was. Both shapes are widest across the middle, so the middle fifths cover
 * far more area than the outer ones.
 *
 * These are the cuts that give each fifth an equal share of the area,
 * computed by clipping the polygon at a vertical line and searching for the
 * x where the clipped area hits the target. Expressed as a fraction of the
 * bounding box, which is what an objectBoundingBox gradient wants.
 */
const AREA_STOPS: Record<'star' | 'pentagon', readonly number[]> = {
  star: [0, 0.316, 0.455, 0.559, 0.686, 1],
  pentagon: [0, 0.273, 0.429, 0.571, 0.727, 1],
};

const STEPS_PER_SHAPE = 5;

interface ShapeProps {
  /** How many fifths of this one are filled, 0 to 5. */
  fifths: number;
  kind: 'star' | 'pentagon';
  /** Unique within the document, because SVG references are global. */
  gradientId: string;
}

function Shape({ fifths, kind, gradientId }: ShapeProps) {
  // A hard two-stop gradient rather than a clipPath: a clip would need its
  // own element per shape and this reads as one paint operation.
  const stop = `${((AREA_STOPS[kind][fifths] ?? 0) * 100).toFixed(1)}%`;
  return (
    <svg aria-hidden="true" className="rank-shape" viewBox="0 0 20 20">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset={stop} stopColor="currentColor" />
          <stop offset={stop} stopColor="transparent" />
        </linearGradient>
      </defs>
      {/* The outline is always drawn, so an empty shape is still a shape
          rather than a gap the eye has to count past. */}
      <path
        d={kind === 'star' ? STAR : PENTAGON}
        fill={`url(#${gradientId})`}
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export interface RankProps {
  /** Whole shapes filled. */
  full: number;
  /** Fifths of the next one, 0-4. Ignored once `full` reaches `total`. */
  step?: number;
  /** How many outlines to draw in all. */
  total: number;
  /** For the tooltip and the screen reader, since the shapes are aria-hidden. */
  label: string;
  kind: 'star' | 'pentagon';
  /** Distinguishes this row's gradients from every other row's. */
  idPrefix: string;
}

export function Rank({ full, step = 0, total, label, kind, idPrefix }: RankProps) {
  // Built as identified objects rather than mapped over a bare index: the
  // shapes are positional and interchangeable, so the index really is their
  // identity, but naming it once here beats scattering index-as-key.
  const shapes = Array.from({ length: total }, (_, index) => ({
    id: `${idPrefix}-${kind}-${index}`,
    fifths:
      index < full ? STEPS_PER_SHAPE : index === full ? Math.min(step, STEPS_PER_SHAPE - 1) : 0,
  }));
  return (
    <span className={`rank rank-${kind}`} title={label}>
      {shapes.map((shape) => (
        <Shape fifths={shape.fifths} gradientId={shape.id} key={shape.id} kind={kind} />
      ))}
      {/* The words are the second channel. Shapes alone are colour and count,
          and a count of five small outlines is exactly the thing a reader
          miscounts — NFR-011 asks for this, and a tooltip does not survive a
          screen reader. */}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
