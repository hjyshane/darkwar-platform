// What a range costs: the totals as a row of cells, the facts they imply as
// notes, and one row per step. Every figure arrives already worked out by the
// planner's totals() (model.ts); this file only draws.

import { Cell, CellGrid } from '../../components/console/Cell';
import { type StepColumn, StepTable } from '../../components/console/StepTable';
import { GameIcon, useIcons, useItemIcons } from '../../lib/gameIcons';
import type { Names } from '../planner/data';
import { exact, short } from '../planner/format';
import type { Tiers } from '../planner/levels';
import { type MaterialTotal, duration } from '../planner/plan';
import { counterName } from './chips';
import { type StepRow, type StepTableModel, levelName, materialKey } from './model';
import type { CalculatorState } from './url';

/** Rows past this hide behind "Show all N" (left to the builder by the spec;
 * twenty fits a laptop screen under the totals). */
const FOLD_AT = 20;

export interface CalculatorResultProps {
  state: CalculatorState;
  table: StepTableModel;
  notes: ReadonlyArray<string>;
  names: Names | undefined;
  tiers: Tiers;
}

function materialName(material: MaterialTotal, names: Names | undefined): string {
  if (material.type === 'counter') return counterName(material.id);
  if (material.type === 'item') return names?.items.get(material.id) ?? `Item ${material.id}`;
  return names?.resources.get(material.id) ?? `Resource ${material.id}`;
}

function Amount({ value }: { value: number | undefined }) {
  if (value === undefined || value === 0) return <span className="calc-none">—</span>;
  return <span title={exact(value)}>{short(value)}</span>;
}

/** What a buff did, for the line under a figure; nothing when it did nothing. */
function buffContext(percent: number, sign: '+' | '−', what: string): string | undefined {
  return percent > 0 ? `${sign}${percent}% ${what}` : undefined;
}

export function CalculatorResult({ state, table, notes, names, tiers }: CalculatorResultProps) {
  const itemIcons = useItemIcons(table.materials.filter((m) => m.type === 'item').map((m) => m.id));
  const resourceIcons = useIcons('resource');
  // Icons are the game's art and members-only (0232): a viewer who may not
  // read them gets an empty map, and the cell is the figure alone.
  const icon = (m: MaterialTotal) =>
    m.type === 'item'
      ? itemIcons.data?.get(m.id)
      : m.type === 'resource'
        ? resourceIcons.data?.get(m.id)
        : undefined;

  const stepLabel = (row: StepRow): string => {
    if (row.level === null) return 'Total';
    if (row.kind === 'pet_break') return `Breakthrough at ${row.level}`;
    const name = (level: number) => levelName(state.kind, row.subject, level, tiers);
    return `${name(row.level - 1)} → ${name(row.level)}`;
  };

  const columns: StepColumn<StepRow>[] = [
    {
      key: 'step',
      header: 'Step',
      cell: (row) => <span className="calc-step">{stepLabel(row)}</span>,
    },
    ...table.materials.map(
      (material): StepColumn<StepRow> => ({
        key: materialKey(material),
        header: materialName(material, names),
        numeric: true,
        cell: (row) => <Amount value={row.amounts.get(materialKey(material))} />,
      }),
    ),
    ...(table.total.seconds > 0
      ? [
          {
            key: 'time',
            header: 'Time',
            numeric: true,
            cell: (row: StepRow) =>
              row.seconds > 0 ? duration(row.seconds) : <span className="calc-none">—</span>,
          },
        ]
      : []),
  ];

  return (
    <>
      <div>
        <fieldset className="calc-totals">
          <legend className="calc-heading">Totals</legend>
          <CellGrid>
            {table.total.seconds > 0 && (
              <Cell
                context={buffContext(state.speed, '+', 'speed')}
                hero
                label="Time"
                value={duration(table.total.seconds)}
              />
            )}
            {table.materials.map((material) => (
              <Cell
                context={
                  state.kind === 'building' && material.type === 'resource'
                    ? buffContext(state.cost, '−', 'cost')
                    : undefined
                }
                key={materialKey(material)}
                label={materialName(material, names)}
                value={
                  <span className="calc-amount" title={exact(material.amount)}>
                    <GameIcon size={18} src={icon(material)} />
                    {short(material.amount)}
                  </span>
                }
              />
            ))}
            <Cell label="Steps" value={table.rows.length} />
          </CellGrid>
        </fieldset>
        {notes.length > 0 && (
          <ul className="calc-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>

      <StepTable
        caption="Step by step"
        columns={columns}
        foldAt={FOLD_AT}
        rowKey={(row) => row.key}
        rows={table.rows}
        total={table.total}
      />
    </>
  );
}
