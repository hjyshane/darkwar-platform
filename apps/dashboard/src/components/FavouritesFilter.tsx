/** "Only the ones I watch", for a table that is otherwise a hundred rows.
 *
 * Hidden entirely when nothing is starred: a filter that can only ever
 * produce an empty table is worse than no filter, because pressing it looks
 * like the data broke.
 */
export function FavouritesFilter({
  active,
  count,
  onChange,
}: {
  active: boolean;
  count: number;
  onChange: (active: boolean) => void;
}) {
  if (count === 0 && !active) {
    return null;
  }
  return (
    <button aria-pressed={active} className="chip" onClick={() => onChange(!active)} type="button">
      ★ {count}
    </button>
  );
}
