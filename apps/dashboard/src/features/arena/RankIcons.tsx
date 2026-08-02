/** Stars and pentagons, drawn rather than counted out in numbers.
 *
 * A rank in this game is two numbers that only mean anything together — four
 * stars and two steps toward the fifth — and printing them as "4" and "2" in
 * separate columns made the reader do the joining. Five star outlines with
 * four filled and the next one two-fifths full says it in one glance, which
 * is also how the game itself says it.
 *
 * The step divides a star into fifths because that is what the payload does:
 * hero stage runs 0-4, and a weapon takes five levels to a step.
 *
 * Inline SVG, no sprite and no icon font: these render inside a table cell
 * that is already scrolling horizontally, and a font would bring a network
 * request that the CSP for this app has no reason to allow.
 */

const STAR =
  'M10 1.5 12.472 7.09 18.5 7.77 14 11.87 15.236 17.8 10 14.8 4.764 17.8 6 11.87 1.5 7.77 8.528 7.09Z';
const PENTAGON = 'M10 1.5 18.5 7.68 15.253 17.68 4.747 17.68 1.5 7.68Z';

interface ShapeProps {
  /** How much of this one is filled, 0 to 1. */
  fill: number;
  path: string;
  /** Unique within the document, because SVG references are global. */
  gradientId: string;
  className: string;
}

function Shape({ fill, path, gradientId, className }: ShapeProps) {
  // A hard two-stop gradient rather than a clipPath: a clip would need its
  // own element per shape and this reads as one paint operation.
  const stop = `${Math.round(Math.min(Math.max(fill, 0), 1) * 100)}%`;
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 20 20">
      <title>{''}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset={stop} stopColor="currentColor" />
          <stop offset={stop} stopColor="transparent" />
        </linearGradient>
      </defs>
      {/* The outline is always drawn, so an empty star is still a star
          rather than a gap the eye has to count past. */}
      <path d={path} fill={`url(#${gradientId})`} stroke="currentColor" strokeWidth="1.4" />
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

const STEPS_PER_SHAPE = 5;

export function Rank({ full, step = 0, total, label, kind, idPrefix }: RankProps) {
  const path = kind === 'star' ? STAR : PENTAGON;
  // Built as identified objects rather than mapped over a bare index: the
  // shapes are positional and interchangeable, so the index really is their
  // identity, but naming it once here beats scattering index-as-key.
  const shapes = Array.from({ length: total }, (_, index) => ({
    id: `${idPrefix}-${kind}-${index}`,
    fill: index < full ? 1 : index === full ? step / STEPS_PER_SHAPE : 0,
  }));
  return (
    <span className={`rank rank-${kind}`} title={label}>
      {shapes.map((shape) => (
        <Shape
          className="rank-shape"
          fill={shape.fill}
          gradientId={shape.id}
          key={shape.id}
          path={path}
        />
      ))}
      {/* The words are the second channel. Shapes alone are colour and count,
          and a count of five small outlines is exactly the thing a reader
          miscounts — NFR-011 asks for this, and a tooltip does not survive a
          screen reader. */}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
