import type { FavouriteKind } from '../lib/useFavourites';

/** A star that pins one row.
 *
 * `aria-pressed` rather than a label that flips between "Favourite" and
 * "Unfavourite": a toggle button is exactly what this is, and the state
 * belongs in the attribute where assistive tech looks for it. The
 * stylesheet keys off the same attribute, so the announced state and the
 * filled star cannot disagree.
 *
 * The accessible name carries the row's name, because a table of forty
 * buttons all called "Favourite" tells a screen-reader user nothing about
 * which one they are on.
 */
export function FavouriteButton({
  kind,
  id,
  label,
  isFavourite,
  onToggle,
}: {
  kind: FavouriteKind;
  id: string | number;
  label: string;
  isFavourite: boolean;
  onToggle: (kind: FavouriteKind, id: string | number) => void;
}) {
  return (
    <button
      aria-label={`Favourite ${label}`}
      aria-pressed={isFavourite}
      className="favourite"
      onClick={() => onToggle(kind, id)}
      type="button"
    >
      <span aria-hidden="true">{isFavourite ? '★' : '☆'}</span>
    </button>
  );
}
