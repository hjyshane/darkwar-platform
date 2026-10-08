import { type CsvColumn, downloadCsv, toCsv } from '../lib/csv';

/** PostgREST answers at most this many rows whatever `.limit()` asks for. */
const POSTGREST_ROW_CAP = 1000;

/** Download the rows the screen already loaded as a CSV.
 *
 * Client-side on purpose: it can only write what this reader's query already
 * returned, so RLS and the view gates apply unchanged and there is nothing new
 * to authorise. It exports the loaded rows, not the filtered ones — a search box
 * is a way of looking, not a choice of what to take.
 */
export function ExportButton<Row>({
  rows,
  columns,
  filename,
}: {
  rows: readonly Row[] | undefined;
  columns: readonly CsvColumn<Row>[];
  /** Without the extension or date; both are added here. */
  filename: string;
}) {
  const capped = rows !== undefined && rows.length >= POSTGREST_ROW_CAP;
  return (
    <button
      type="button"
      disabled={rows === undefined || rows.length === 0}
      title={
        capped
          ? `Only the first ${POSTGREST_ROW_CAP} rows are loaded; this file stops there.`
          : undefined
      }
      onClick={() => {
        if (rows === undefined) {
          return;
        }
        const day = new Date().toISOString().slice(0, 10);
        downloadCsv(`${filename}-${day}.csv`, toCsv(rows, columns));
      }}
    >
      Export CSV{capped ? ' (first 1000)' : ''}
    </button>
  );
}
