import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  type GameNameHit,
  type GameTableMeta,
  type TextMode,
  type ViewerState,
  fetchGameTable,
  fetchGameTables,
  searchGameNames,
  sizeLabel,
  viewerHash,
  viewerStateFromHash,
} from '../../lib/gameTables';
import { replaceHash, useHash } from '../../lib/useHash';
import { GameDataGrid } from './GameDataGrid';
import { GameDataRow } from './GameDataRow';

/** The game client's own datatables, every one of them, readable (0343).
 *
 * The server sends numbers; the client's files say what they mean. Until now
 * reading one of those files meant a Python session on the machine that has
 * the bundles, and choosing which column to promote to a real table meant
 * doing that first. This screen puts the files where the choosing happens.
 *
 * Three things it adds to a raw dump, each labelled as a guess where it
 * shows: a column that holds localisation keys is drawn as text in the
 * language chosen (the key stays under the pointer); a column named after
 * another table (`skill_id`) links into it; a name typed into the box at the
 * top is found across every table that has one.
 *
 * The address carries the table, the row and the language, so a link to a
 * row can be sent. Picking a table or a row is navigation and goes into the
 * history; switching language is not, and does not.
 */
export function GameDataSetting() {
  const hash = useHash();
  const state = viewerStateFromHash(hash);
  const tables = useQuery({ queryKey: ['game-tables'], queryFn: fetchGameTables });
  const meta = tables.data?.find((entry) => entry.name === state.table) ?? null;
  const table = useQuery({
    queryKey: ['game-table', meta?.name ?? ''],
    queryFn: () => fetchGameTable(meta as GameTableMeta),
    enabled: meta !== null,
    // A dump changes once per client update; re-reading 10,000 rows on
    // every focus is not what anybody wants.
    staleTime: 60 * 60 * 1000,
  });
  const names = useMemo(
    () => new Set((tables.data ?? []).map((entry) => entry.name)),
    [tables.data],
  );

  const go = (next: Partial<ViewerState>) => {
    window.location.hash = viewerHash({ ...state, ...next });
  };
  const setMode = (mode: TextMode) => replaceHash(viewerHash({ ...state, mode }));

  if (tables.isPending) {
    return <p className="empty">Loading the list of tables…</p>;
  }
  if (tables.error) {
    return <p className="error">{tables.error.message}</p>;
  }
  if (tables.data === undefined || tables.data.length === 0) {
    return (
      <p className="empty">
        No tables have been dumped yet. On the machine with the game bundles, run{' '}
        <code>dw-collector game-dump</code> (docs/runbooks/game-data.md).
      </p>
    );
  }

  return (
    <div className="gd-browser">
      <aside className="gd-side">
        <NameSearch mode={state.mode} />
        <TableList
          active={meta?.name ?? null}
          onPick={(name) => go({ table: name, row: null })}
          tables={tables.data}
        />
      </aside>
      <div className="gd-main">
        {meta === null ? (
          <Overview tables={tables.data} />
        ) : (
          <>
            <TableStrip meta={meta} mode={state.mode} onMode={setMode} />
            {table.isPending && (
              <p className="empty">
                Loading {meta.row_count.toLocaleString()} rows in {meta.chunk_count}{' '}
                {meta.chunk_count === 1 ? 'piece' : 'pieces'}…
              </p>
            )}
            {table.error && <p className="error">{table.error.message}</p>}
            {table.data && (
              <GameDataGrid
                key={table.data.meta.name}
                mode={state.mode}
                onPickRow={(row) => go({ row })}
                selected={state.row}
                table={table.data}
                tables={names}
              />
            )}
          </>
        )}
      </div>
      {table.data && state.row !== null && (
        <GameDataRow
          mode={state.mode}
          onClose={() => go({ row: null })}
          rowId={state.row}
          table={table.data}
          tables={names}
        />
      )}
    </div>
  );
}

function Overview({ tables }: { tables: readonly GameTableMeta[] }) {
  const rows = tables.reduce((sum, entry) => sum + entry.row_count, 0);
  const bytes = tables.reduce((sum, entry) => sum + entry.byte_size, 0);
  const localised = tables.filter((entry) => entry.loc_columns.length > 0).length;
  const newest = tables.reduce(
    (latest, entry) => (entry.dumped_at > latest ? entry.dumped_at : latest),
    '',
  );
  return (
    <div className="gd-overview">
      <p>
        <strong>{tables.length}</strong> tables, <strong>{rows.toLocaleString()}</strong> rows,{' '}
        {sizeLabel(bytes)} of them; <strong>{localised}</strong> carry text in a column. Client
        build <code>{tables[0]?.client_version}</code>, dumped{' '}
        {newest === '' ? 'never' : new Date(newest).toLocaleString()}.
      </p>
      <p className="subtle">
        Pick a table on the left, or type a name into the box above the list to find which table
        holds it. Columns that hold text are drawn in the chosen language; the key is under the
        pointer. A column named after another table (<code>skill_id</code>) links into it — a guess
        from the name, and a wrong guess lands on an empty row rather than the wrong one.
      </p>
    </div>
  );
}

function TableStrip({
  meta,
  mode,
  onMode,
}: {
  meta: GameTableMeta;
  mode: TextMode;
  onMode: (mode: TextMode) => void;
}) {
  return (
    <header className="gd-strip">
      <h3 className="gd-title">{meta.name}</h3>
      <dl className="gd-facts">
        <div>
          <dt>Rows</dt>
          <dd>{meta.row_count.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Columns</dt>
          <dd>{meta.columns.length}</dd>
        </div>
        <div>
          <dt>Text columns</dt>
          <dd>{meta.loc_columns.length}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{sizeLabel(meta.byte_size)}</dd>
        </div>
        <div>
          <dt>Dumped</dt>
          <dd>{new Date(meta.dumped_at).toLocaleDateString()}</dd>
        </div>
      </dl>
      <fieldset className="gd-modes">
        <legend className="visually-hidden">Text language</legend>
        {(
          [
            ['en', 'English'],
            ['ko', '한국어'],
            ['raw', 'Keys'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={mode === value}
            key={value}
            onClick={() => onMode(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </fieldset>
    </header>
  );
}

function TableList({
  tables,
  active,
  onPick,
}: {
  tables: readonly GameTableMeta[];
  active: string | null;
  onPick: (name: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = needle === '' ? tables : tables.filter((entry) => entry.name.includes(needle));
  return (
    <nav aria-label="Tables" className="gd-list">
      <label className="gd-filter">
        <span className="visually-hidden">Filter tables</span>
        <input
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${tables.length} tables`}
          type="search"
          value={filter}
        />
      </label>
      <p className="gd-count subtle">
        {shown.length === tables.length
          ? `${tables.length} tables`
          : `${shown.length} of ${tables.length} tables`}
      </p>
      <ul>
        {shown.map((entry) => (
          <li key={entry.name}>
            <button
              aria-current={entry.name === active ? 'true' : undefined}
              className="gd-table-pick"
              onClick={() => onPick(entry.name)}
              type="button"
            >
              <span className="gd-table-name">{entry.name}</span>
              <span className="gd-table-rows">
                {entry.row_count.toLocaleString()}
                {entry.loc_columns.length > 0 && (
                  <span
                    aria-label="has text columns"
                    className="gd-text-dot"
                    title="Has text columns"
                  >
                    T
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Which table is Orange Skill Book in?" — the name index, both languages. */
function NameSearch({ mode }: { mode: TextMode }) {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(handle);
  }, [typed]);
  const hits = useQuery({
    queryKey: ['game-names', query],
    queryFn: () => searchGameNames(query),
    enabled: query.length >= 2,
  });
  const label = (hit: GameNameHit) =>
    mode === 'ko' ? (hit.name_ko ?? hit.name_en) : (hit.name_en ?? hit.name_ko);
  return (
    <div className="gd-search">
      <label>
        <span className="visually-hidden">Find a name in any table</span>
        <input
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Find a name in any table…"
          type="search"
          value={typed}
        />
      </label>
      {query.length >= 2 && (
        <div className="gd-hits">
          {hits.isPending && <p className="subtle">Searching…</p>}
          {hits.error && <p className="error">{hits.error.message}</p>}
          {hits.data && hits.data.length === 0 && <p className="subtle">No name matches.</p>}
          {hits.data && hits.data.length > 0 && (
            <ul>
              {hits.data.map((hit) => (
                <li key={`${hit.table_name}:${hit.row_id}`}>
                  <a href={viewerHash({ table: hit.table_name, row: hit.row_id, mode })}>
                    <span className="gd-hit-name">{label(hit)}</span>
                    <span className="gd-hit-where">
                      {hit.table_name} · {hit.row_id}
                    </span>
                  </a>
                </li>
              ))}
              {hits.data.length === 50 && (
                <li className="subtle">First 50 shown; type more to narrow it.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
