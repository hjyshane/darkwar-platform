/** The game's own symbols, redrawn as flat silhouettes.
 *
 * The class letters F/S/R were a translation the reader had to learn; the
 * game already draws an axe, a bow and a gear for the same three, and the
 * counter cycle poster in game is those three shapes. Using them removes a
 * step rather than adding decoration.
 *
 * Every glyph is aria-hidden and every caller puts the word beside it — in a
 * tooltip, in a visually-hidden span, or both. NFR-011 does not allow a
 * shape to be the only thing that says which class a hero is.
 */

export type GlyphName = 'axe' | 'bow' | 'gear' | 'hand' | 'head' | 'body' | 'foot';

const PATHS: Record<GlyphName, string> = {
  // Fighter. Broad head with the poll notched out, haft on the diagonal —
  // the game's own axe rather than a hammer-ish T. Chosen by rendering four
  // candidates at 14px, 24px and 56px and keeping the one still legible in
  // a chip.
  axe: 'M12.6 1.6C16.2 2.4 18.8 5.6 18.8 9.4 18.8 11 18.4 12.5 17.6 13.8L11.6 10.2 13.4 7.6 10.4 5.9ZM10.2 8.2 12.6 10.6 5.3 17.9 2.9 15.5Z',
  // Shooter. Stave curving away from a nocked arrow, which is the crossed
  // silhouette the game draws. Solid pieces rather than an outline: a thin
  // stroke is the first thing to vanish at chip size.
  bow: 'M15.8 2.6A12 12 0 0 0 2.6 15.8L5.4 15.6A9.4 9.4 0 0 1 15.6 5.4ZM17.4 17.4 7 7 5.6 8.4 16 18.8ZM2.2 2.2 8 3.4 3.4 8Z',
  // Rider. Ring with six teeth, hollow at the centre.
  gear: 'M10 1.6l1.9 1.6 2.4-.6.9 2.3 2.3.9-.6 2.4L18.4 10l-1.6 1.9.6 2.4-2.3.9-.9 2.3-2.4-.6L10 18.4l-1.9-1.6-2.4.6-.9-2.3-2.3-.9.6-2.4L1.6 10l1.6-1.9-.6-2.4 2.3-.9.9-2.3 2.4.6ZM10 6.4A3.6 3.6 0 1 0 10 13.6 3.6 3.6 0 0 0 10 6.4Z',
  // Gauntlet.
  hand: 'M6.2 2.6h2.2v6h.9v-5h2.2v5h.9v-4h2.2v4h.9V6.4h2.1v6.2c0 3-2.3 5-5.4 5H9.6c-2.6 0-4.7-1.7-5.4-4.2L2.6 8.2l2-.8 1.6 3Z',
  // Helmet.
  head: 'M10 2.2c4 0 7 2.9 7 6.8v6.4h-3.4v-3.1h-1.9v3.1H8.3v-3.1H6.4v3.1H3V9c0-3.9 3-6.8 7-6.8Zm0 2.6a4.3 4.3 0 0 0-4.3 4.3h8.6A4.3 4.3 0 0 0 10 4.8Z',
  // Chestplate.
  body: 'M6.4 2.4 10 4.2l3.6-1.8 4 1.9-1.3 4.1-1.5-.5v9.7H5.2V7.9l-1.5.5-1.3-4.1Z',
  // Boot.
  foot: 'M5.2 2.4h4.4v7.2c0 1.4.6 2.4 1.8 3.1l4.9 2.8c.9.5 1.3 1.1 1.3 2v0.1H5.2Z',
};

export interface GlyphProps {
  name: GlyphName;
  /** Named for the tooltip and the screen reader. */
  label: string;
  /** False where the caller already prints the word next to the glyph —
   * otherwise a screen reader hears it twice and the cell's text content
   * reads "FighterFighter". */
  spoken?: boolean;
  className?: string;
}

export function Glyph({ name, label, spoken = true, className }: GlyphProps) {
  return (
    <span className={['glyph', className].filter(Boolean).join(' ')} title={label}>
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d={PATHS[name]} fill="currentColor" />
      </svg>
      {spoken && <span className="visually-hidden">{label}</span>}
    </span>
  );
}

/** The glyph the game draws for each troop class. Unknown classes get no
 * glyph — an unfamiliar shape would be a fourth class the reader cannot
 * name, where a question mark is honest. */
export const CLASS_GLYPHS: Record<number, GlyphName> = {
  1: 'axe',
  2: 'bow',
  3: 'gear',
};

/** Which slot a piece of gear goes in, from the two digits before the tail
 * of its id — 4101xx is a hand, 4103xx a head.
 *
 * 01 and 03 are confirmed: the user read 22002's gear off the game as hand
 * gold lv32 and head gold lv10, and that hero's equips are 410100 lv32 and
 * 410300 lv10.
 *
 * 02 and 04 are NOT. Both of the remaining pieces read level 0, so the only
 * thing separating them is the order the user listed them in — body before
 * legs — against the order the payload listed them. That is one weak signal,
 * and if any two of these are swapped it is these two.
 */
export const GEAR_SLOT_GLYPHS: Record<number, { glyph: GlyphName; label: string }> = {
  1: { glyph: 'hand', label: 'Hand' },
  2: { glyph: 'foot', label: 'Foot' },
  3: { glyph: 'head', label: 'Head' },
  4: { glyph: 'body', label: 'Body' },
};

export function gearSlot(equipmentId: number): { glyph: GlyphName; label: string } | null {
  return GEAR_SLOT_GLYPHS[Math.floor((equipmentId % 1000) / 100)] ?? null;
}
