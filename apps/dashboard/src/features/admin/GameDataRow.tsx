import type { Json } from '@dw/shared-types';
import { type GameTable, type TextMode, refTarget, viewerHash } from '../../lib/gameTables';

/** One row, every column, both languages (0343).
 *
 * The grid clips a cell to a line; this is where the whole thing is read. A
 * nested table is printed as indented JSON, a localised key shows the key
 * and both its texts, a `*_id` column links into the table it names. Also
 * the one place the raw key and the text sit side by side, which is how a
 * wrong "this column is text" guess gets noticed.
 */
export function GameDataRow({
  table,
  tables,
  rowId,
  mode,
  onClose,
}: {
  table: GameTable;
  tables: ReadonlySet<string>;
  rowId: string;
  mode: TextMode;
  onClose: () => void;
}) {
  const { meta, rows, strings } = table;
  const row = rows.find((entry) => entry.id === rowId);
  const localised = new Set(meta.loc_columns);
  return (
    <aside aria-labelledby="gd-row-heading" className="gd-drawer">
      <header className="gd-drawer-head">
        <h3 id="gd-row-heading">
          <span className="gd-drawer-table">{meta.name}</span> <code>{rowId}</code>
        </h3>
        <button aria-label="Close row" onClick={onClose} type="button">
          ×
        </button>
      </header>
      {row === undefined ? (
        <p className="empty">
          No row <code>{rowId}</code> in <code>{meta.name}</code>. If a link brought you here, the
          column it came from was guessed to point at this table and does not.
        </p>
      ) : (
        <dl className="gd-fields">
          {meta.columns.map((column) => {
            const value = row.values[column];
            const target = refTarget(column, tables);
            return (
              <div className="gd-field" key={column}>
                <dt>
                  {column}
                  {localised.has(column) && <span className="gd-col-mark">T</span>}
                </dt>
                <dd>
                  <FieldValue
                    localised={localised.has(column)}
                    mode={mode}
                    strings={strings}
                    target={target}
                    value={value}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </aside>
  );
}

function FieldValue({
  value,
  localised,
  target,
  mode,
  strings,
}: {
  value: Json | undefined;
  localised: boolean;
  target: string | null;
  mode: TextMode;
  strings: GameTable['strings'];
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="gd-null-mark">—</span>;
  }
  if (typeof value === 'object') {
    return <pre className="gd-pre">{JSON.stringify(value, null, 2)}</pre>;
  }
  const raw = String(value);
  if (localised) {
    const en = strings.en[raw];
    const ko = strings.ko[raw];
    return (
      <div className="gd-both">
        <code className="gd-key">{raw}</code>
        {en !== undefined && <span lang="en">{en}</span>}
        {ko !== undefined && <span lang="ko">{ko}</span>}
        {en === undefined && ko === undefined && (
          <span className="subtle">No text for this key in either language.</span>
        )}
      </div>
    );
  }
  if (target !== null && (typeof value === 'number' || /^\d+$/.test(raw))) {
    return (
      <a href={viewerHash({ table: target, row: raw, mode })}>
        {raw} <span className="subtle">→ {target}</span>
      </a>
    );
  }
  return <span className={typeof value === 'number' ? 'num' : undefined}>{raw}</span>;
}
