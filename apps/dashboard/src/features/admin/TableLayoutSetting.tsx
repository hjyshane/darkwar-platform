import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  type ColumnSpec,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  TABLE_LAYOUT_KEY,
  type TableLayout,
  type TableLayouts,
  arrangeColumns,
  moveColumn,
  toggleHidden,
} from '../../lib/tableLayout';
import { useTableLayouts } from '../../lib/useTableLayout';
import {
  TABLE_ID as ALLIANCE_MEMBERS_TABLE_ID,
  allianceMemberColumnSpecs,
} from '../alliance/AllianceMemberTable';
import { TABLE_ID as ARENA_TABLE_ID, arenaColumnSpecs } from '../arena/ArenaTable';
import {
  TABLE_ID as CROSS_TABLE_ID,
  crossRankingColumnSpecs,
} from '../crossRankings/CrossRankingTable';
import {
  TABLE_ID as ALLIANCE_RANKING_TABLE_ID,
  allianceRankingColumnSpecs,
} from '../rankings/AllianceRankingTable';
import {
  TABLE_ID as MEMBERS_TABLE_ID,
  columnSpecs as memberColumnSpecs,
} from '../roster/RosterTable';
import {
  TABLE_ID as SEASON_ALLIANCE_TABLE_ID,
  seasonAllianceColumnSpecs,
} from '../season/SeasonAllianceTable';
import {
  TABLE_ID as SEASON_BUILDING_TABLE_ID,
  seasonBuildingColumnSpecs,
} from '../season/SeasonBuildingTable';
import {
  TABLE_ID as SEASON_FORCE_TABLE_ID,
  seasonForceColumnSpecs,
} from '../season/SeasonForceTable';
import {
  TABLE_ID as SERVER_PLAYERS_TABLE_ID,
  serverPlayerColumnSpecs,
} from '../server/ServerPlayerTable';

/** Which tables this screen can arrange.
 *
 * A table joins by declaring its columns and picking an id — two lines here and an
 * `arrangeColumns` call in the table itself. It is a list rather than a lookup
 * because the screen has to name the tables an admin has NOT arranged as well as
 * the ones they have.
 *
 * A table that is NOT here still hand-writes its headers, and listing it before
 * it reads the setting would offer an arrangement that changes nothing — a worse
 * failure than the missing feature, because it looks like it worked. The admin
 * screens are deliberately absent: arranging the collector health table is noise,
 * not a feature.
 */
interface ArrangeableTable {
  id: string;
  label: string;
  columns: () => ColumnSpec[];
}

const TABLES: ArrangeableTable[] = [
  { id: MEMBERS_TABLE_ID, label: 'Members', columns: memberColumnSpecs },
  {
    id: ALLIANCE_MEMBERS_TABLE_ID,
    label: 'Alliance page — members',
    columns: allianceMemberColumnSpecs,
  },
  { id: SERVER_PLAYERS_TABLE_ID, label: 'Server players', columns: serverPlayerColumnSpecs },
  { id: CROSS_TABLE_ID, label: 'Cross-server rankings', columns: crossRankingColumnSpecs },
  {
    id: SEASON_ALLIANCE_TABLE_ID,
    label: 'Season — coal production',
    columns: seasonAllianceColumnSpecs,
  },
  { id: SEASON_FORCE_TABLE_ID, label: 'Season — influence', columns: seasonForceColumnSpecs },
  {
    id: SEASON_BUILDING_TABLE_ID,
    label: 'Season — member buildings',
    columns: seasonBuildingColumnSpecs,
  },
  {
    id: ALLIANCE_RANKING_TABLE_ID,
    label: 'Alliance rankings',
    columns: allianceRankingColumnSpecs,
  },
  { id: ARENA_TABLE_ID, label: 'Arena', columns: arenaColumnSpecs },
];

/** Column order, visibility and width, for every table at once.
 *
 * ONE SAVE, ONE ROW. `app_settings.table_layout` holds every table, so the editable
 * copy is the whole object and a save writes the whole object. Saving one table at a
 * time would need a read-modify-write against a row another admin may have changed
 * in between, and this is not worth a merge.
 *
 * WHAT IS STORED IS THE CHANGE, NOT THE RESULT. An untouched table has no entry, an
 * untouched column has no width, and nothing is hidden unless somebody hid it. That
 * is what lets a column added next month appear for everybody instead of vanishing
 * behind an arrangement saved before it existed.
 */
export function TableLayoutSetting() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useTableLayouts();
  const [draft, setDraft] = useState<TableLayouts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (data !== undefined) {
      setDraft(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (drafted: TableLayouts) => {
      // A table reset to its declared order is an ABSENT key, not a key holding
      // nothing. `{}` would read back as an arrangement that happens to change
      // nothing, and the difference shows the day a column is added: the empty
      // entry is harmless, but writing one teaches the shape wrong.
      const value: Record<string, TableLayout> = {};
      for (const [tableId, layout] of Object.entries(drafted)) {
        if (layout !== undefined) {
          value[tableId] = layout;
        }
      }
      const { error: writeError } = await supabase
        .from('app_settings')
        .upsert({ key: TABLE_LAYOUT_KEY, value });
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      setFailed(true);
      setMessage(e.message);
    },
  });

  if (isPending || draft === null) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the arrangement: {error.message}</p>;
  }

  const update = (tableId: string, change: (layout: TableLayout) => TableLayout) => {
    setDraft({ ...draft, [tableId]: change(draft[tableId] ?? {}) });
  };

  return (
    <>
      <p className="subtle">
        Order the columns, hide the ones nobody reads, and set a width where the browser guesses
        badly. This is one arrangement for everybody, not a per-browser one — so “the duel column on
        the right” means the same thing to whoever you are talking to.
      </p>

      {TABLES.map((table) => {
        const layout = draft[table.id] ?? {};
        const declared = table.columns();
        // Hidden columns are absent from `arrangeColumns`, so the editor works from the
        // arrangement of every declared column and marks the hidden ones instead. An
        // admin cannot bring back what the form no longer lists.
        const arranged = arrangeColumns(
          declared,
          layout.order === undefined ? {} : { order: layout.order },
        );
        const hidden = new Set(layout.hidden ?? []);
        return (
          <div key={table.id} style={{ marginBottom: '1.5rem' }}>
            <h3>{table.label}</h3>
            <ol className="picked">
              {arranged.map((column, index) => {
                const width = layout.width?.[column.id];
                const isHidden = hidden.has(column.id);
                return (
                  <li key={column.id}>
                    <span className={isHidden ? 'subtle' : ''}>
                      {column.label}
                      {column.fixed === true && <span className="badge">always shown</span>}
                      {isHidden && <span className="badge">hidden</span>}
                    </span>
                    <span className="row">
                      <button
                        className="linklike"
                        disabled={index === 0}
                        onClick={() =>
                          update(table.id, (current) => ({
                            ...current,
                            order: moveColumn(arranged, column.id, -1),
                          }))
                        }
                        type="button"
                      >
                        up
                      </button>
                      <button
                        className="linklike"
                        disabled={index === arranged.length - 1}
                        onClick={() =>
                          update(table.id, (current) => ({
                            ...current,
                            order: moveColumn(arranged, column.id, 1),
                          }))
                        }
                        type="button"
                      >
                        down
                      </button>
                      {/* A fixed column has no hide button rather than a disabled one:
                          the name column is how you tell one row from another, and
                          offering the choice invites the question. */}
                      {column.fixed !== true && (
                        <button
                          className="linklike"
                          onClick={() =>
                            update(table.id, (current) => ({
                              ...current,
                              hidden: toggleHidden(current.hidden ?? [], column.id),
                            }))
                          }
                          type="button"
                        >
                          {isHidden ? 'show' : 'hide'}
                        </button>
                      )}
                      <input
                        aria-label={`Width of ${column.label} in pixels`}
                        max={MAX_COLUMN_WIDTH}
                        min={MIN_COLUMN_WIDTH}
                        onChange={(event) => {
                          const raw = event.target.value;
                          update(table.id, (current) => {
                            const widths = { ...(current.width ?? {}) };
                            // Clearing the box means "let the browser size it", which is
                            // a different state from a small number and has to be
                            // storable.
                            if (raw === '') {
                              delete widths[column.id];
                            } else {
                              widths[column.id] = Number(raw);
                            }
                            return { ...current, width: widths };
                          });
                        }}
                        placeholder="auto"
                        style={{ width: '5rem' }}
                        type="number"
                        value={width === undefined ? '' : width}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
            <button
              className="linklike"
              onClick={() =>
                setDraft(
                  Object.fromEntries(
                    Object.entries(draft).filter(([key]) => key !== table.id),
                  ) as TableLayouts,
                )
              }
              type="button"
            >
              reset {table.label} to the declared order
            </button>
          </div>
        );
      })}

      <div className="row">
        <button disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">
          Save
        </button>
      </div>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </>
  );
}
