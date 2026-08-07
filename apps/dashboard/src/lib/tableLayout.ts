/** Which columns a table shows, in what order, and how wide.
 *
 * ONE SHARED SETTING, NOT A PER-BROWSER ONE. An admin arranges the members table
 * and every member sees that arrangement. localStorage was the cheaper option and
 * it is the wrong one here: the alliance is looked at together, somebody says "the
 * duel column on the right", and a layout that differs per browser makes that
 * sentence false. It lives in `app_settings`, which members may read and only
 * `settings.write` may change — the same place the overview figures and the member
 * formulas already live.
 *
 * KEYED BY TABLE. One settings row holds every table's arrangement, so a new table
 * adopts this by declaring its columns and picking an id; nothing here changes.
 *
 * THE STORED SHAPE IS A PATCH, NOT A SNAPSHOT. Only what an admin actually changed
 * is written: an order they never touched is absent, and a column added to the
 * dashboard later appears in its declared position rather than being hidden because
 * a stored list from last month did not mention it. That is the failure this shape
 * exists to avoid — a saved column list silently swallowing every column added
 * after it was saved.
 */
export const TABLE_LAYOUT_KEY = 'table_layout';

/** A column as the table itself declares it: identity and how it behaves.
 *
 * The renderer stays in the table. This is the part an admin can rearrange, and
 * keeping it to identity means a table can adopt the mechanism without handing its
 * cells over to a generic renderer that would have to know about freshness badges,
 * rank badges and computed formulas.
 */
export interface ColumnSpec {
  id: string;
  label: string;
  /** Columns that must stay put. The name column is pinned to the left on a phone
   * and is how you tell one row from another; hiding it leaves a grid of figures
   * belonging to nobody. */
  fixed?: boolean;
}

/** A type alias rather than an interface on purpose: this value is written straight
 * into `app_settings.value`, which is typed `Json`, and only a type alias gets the
 * implicit index signature that assignment needs. An interface here fails to
 * typecheck at the upsert with an error about `Json[]` that says nothing about the
 * real cause. */
export type TableLayout = {
  /** Column ids, in the order an admin arranged them. Ids this table does not
   * declare are ignored; declared ids missing from it keep their declared place. */
  order?: string[];
  hidden?: string[];
  /** Column id to width in pixels. Absent means the browser decides, which is the
   * right default — a table of figures sizes itself better than a guess. */
  width?: Record<string, number>;
};

export type TableLayouts = Record<string, TableLayout | undefined>;

/** The columns to render, arranged and filtered.
 *
 * ORDER IS A PREFERENCE, NOT A LIST. Stored ids come first in their stored order;
 * anything the table declares but the stored order omits keeps its declared
 * position relative to what is left. So adding a column to the dashboard shows it
 * to everybody immediately, rather than hiding it behind a saved arrangement that
 * predates it.
 *
 * A fixed column cannot be hidden, whatever the setting says. An admin who hides
 * the name column has not chosen a layout, they have made a mistake, and the table
 * is where that gets refused rather than in the form.
 */
export function arrangeColumns(
  columns: readonly ColumnSpec[],
  layout: TableLayout | undefined,
): ColumnSpec[] {
  const hidden = new Set(layout?.hidden ?? []);
  const visible = columns.filter((column) => column.fixed === true || !hidden.has(column.id));
  const stored = layout?.order ?? [];
  if (stored.length === 0) {
    return visible;
  }
  const byId = new Map(visible.map((column) => [column.id, column]));
  const out: ColumnSpec[] = [];
  for (const id of stored) {
    const column = byId.get(id);
    if (column !== undefined) {
      out.push(column);
      byId.delete(id);
    }
  }
  // Whatever the stored order never mentioned, in the order the table declared it.
  for (const column of visible) {
    if (byId.has(column.id)) {
      out.push(column);
    }
  }
  return out;
}

/** Move one column, returning the full order.
 *
 * Returns the WHOLE order rather than a sparse one, so a saved arrangement does not
 * depend on which columns happened to exist when a button was pressed. Out-of-range
 * moves are no-ops rather than errors: the buttons at the ends are disabled, and a
 * silent no-op is better than a crash if one is ever not.
 */
export function moveColumn(
  columns: readonly ColumnSpec[],
  id: string,
  direction: -1 | 1,
): string[] {
  const ids = columns.map((column) => column.id);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) {
    return ids;
  }
  const moved = [...ids];
  const [taken] = moved.splice(from, 1);
  if (taken !== undefined) {
    moved.splice(to, 0, taken);
  }
  return moved;
}

/** Turn a column off or on, keeping the stored list to what is actually hidden. */
export function toggleHidden(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id];
}

/** The width to render, or undefined to let the browser size the column.
 *
 * Clamped rather than trusted. A width of 8px is a column nobody can read and a
 * width of 4000 pushes every other column off the screen; both are one slip of a
 * number input away, and neither is a layout anybody chose.
 */
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 480;

export function columnWidth(layout: TableLayout | undefined, id: string): number | undefined {
  const stored = layout?.width?.[id];
  if (stored === undefined || !Number.isFinite(stored)) {
    return undefined;
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(stored)));
}
