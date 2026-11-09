import { Cell, CellGrid } from '../../components/console/Cell';
import { Chip } from '../../components/console/Chip';
import { Led } from '../../components/console/Led';
import { type StepColumn, StepTable } from '../../components/console/StepTable';
import { GameIcon } from '../../lib/gameIcons';
import { type BestDay, bestDays } from './bestDays';
import { stockLed } from './guides';
import { type PrepLine, type Stock, derivePrep } from './prepCheck';
import { type ScoreItemMap, mergeScoreItems } from './scoreItems';
import type {
  Drop,
  ParsedSection,
  PointRow,
  PointTablePayload,
  PrepItem,
  PrepPayload,
  RewardsPayload,
  SourceRow,
  SourcesPayload,
  StagesPayload,
} from './sections/index';
import { type ItemCatalogue, type ItemRef, itemRefKey, resolveItemRef } from './sections/itemRef';
import './guides.css';

// An event guide's sections on the console kit (0310).
//
// One renderer per kind, and nothing per event: a new event is rows in
// event_guide_sections, not a component. Presentational — every figure comes
// in through props, so the same code draws a member's guide, a community
// reader's (no stock, perhaps no icons) and the editor's preview.

export interface GuideSectionsProps {
  sections: readonly ParsedSection[];
  catalogue: ItemCatalogue;
  /** `itemRefKey` → image, for the refs the reader may see art for. */
  iconSrc: ReadonlyMap<string, string>;
  scoreItems: ScoreItemMap;
  /** The viewer's own stock, or null: then prep shows the rule, not a figure. */
  stock: Stock | null;
  stockReadAt: string | null;
  now: Date;
}

interface Lookup {
  catalogue: ItemCatalogue;
  iconSrc: ReadonlyMap<string, string>;
}

const count = new Intl.NumberFormat('en');

const DEFAULT_TITLE: Record<ParsedSection['kind'], string> = {
  rewards: 'Rewards',
  stages: 'Stages',
  point_table: 'What scores',
  prep: 'Prepare now',
  sources: 'Where it comes from',
  notes: 'Notes',
};

function labelOf(ref: ItemRef, lookup: Lookup): string {
  return resolveItemRef(ref, lookup.catalogue).label;
}

function iconOf(ref: ItemRef | null | undefined, lookup: Lookup, size = 12) {
  if (!ref) return undefined;
  const src = lookup.iconSrc.get(itemRefKey(ref));
  return src ? <GameIcon size={size} src={src} /> : undefined;
}

function ItemName({ item, lookup }: { item: ItemRef; lookup: Lookup }) {
  return (
    <span className="eg-item">
      {iconOf(item, lookup, 16)}
      {labelOf(item, lookup)}
    </span>
  );
}

export function GuideSections({
  sections,
  catalogue,
  iconSrc,
  scoreItems,
  stock,
  stockReadAt,
  now,
}: GuideSectionsProps) {
  if (sections.length === 0) {
    return <p className="empty">This guide has no sections yet.</p>;
  }
  const lookup: Lookup = { catalogue, iconSrc };
  // The score map is laid over client rows before anything reads an item off
  // them, so best days work on imported tables once an officer has mapped them.
  const merged = new Map<string, PointTablePayload>();
  for (const section of sections) {
    if (section.kind === 'point_table') {
      merged.set(section.section_id, mergeScoreItems(section.payload, scoreItems));
    }
  }
  const best = bestDays([...merged.values()]);

  return (
    <div className="eg-sections">
      {sections.map((section) => (
        <section className="eg-section" data-kind={section.kind} key={section.section_id}>
          <h3>{section.title ?? derivedTitle(section)}</h3>
          {section.kind === 'rewards' && <Rewards lookup={lookup} payload={section.payload} />}
          {section.kind === 'stages' && <Stages lookup={lookup} payload={section.payload} />}
          {section.kind === 'point_table' && (
            <PointTable
              best={best}
              lookup={lookup}
              table={merged.get(section.section_id) ?? section.payload}
            />
          )}
          {section.kind === 'prep' && (
            <Prep
              lookup={lookup}
              now={now}
              payload={section.payload}
              stock={stock}
              stockReadAt={stockReadAt}
            />
          )}
          {section.kind === 'sources' && <Sources payload={section.payload} />}
          {section.kind === 'notes' && <Notes text={section.payload.text} />}
        </section>
      ))}
    </div>
  );
}

function derivedTitle(section: ParsedSection): string {
  if (section.kind !== 'point_table') return DEFAULT_TITLE[section.kind];
  const { day, theme } = section.payload;
  if (day === null) return theme ?? DEFAULT_TITLE.point_table;
  return theme ? `Day ${day} · ${theme}` : `Day ${day}`;
}

function Rewards({ payload, lookup }: { payload: RewardsPayload; lookup: Lookup }) {
  return (
    <ul className="eg-rewards">
      {payload.items.map((reward, index) => (
        // Rewards have no id of their own and an officer may list two alike.
        // biome-ignore lint/suspicious/noArrayIndexKey: a static list, never reordered in place
        <li key={index}>
          <Chip icon={iconOf(reward.item_ref, lookup)} label={reward.label} suffix={reward.kind} />
          {reward.how !== '' && <span className="eg-how">{reward.how}</span>}
        </li>
      ))}
    </ul>
  );
}

function Drops({ drops, lookup }: { drops: readonly Drop[]; lookup: Lookup }) {
  if (drops.length === 0) return <span className="eg-none">—</span>;
  return (
    <span className="eg-drops">
      {drops.map((drop) => (
        <Chip
          figure={`×${count.format(drop.qty)}`}
          icon={iconOf(drop.item_ref, lookup)}
          key={itemRefKey(drop.item_ref)}
          label={labelOf(drop.item_ref, lookup)}
        />
      ))}
    </span>
  );
}

interface StageRow {
  key: string;
  group: string;
  stage: string;
  drops: readonly Drop[];
}

function Stages({ payload, lookup }: { payload: StagesPayload; lookup: Lookup }) {
  const rows: StageRow[] = payload.groups.flatMap((group, groupIndex) =>
    group.stages.map((stage, stageIndex) => ({
      key: `${groupIndex}:${stage.n}:${stageIndex}`,
      // The group's name once, on its first row: the rows under it belong to it.
      group: stageIndex === 0 ? group.label : '',
      stage: String(stage.n),
      drops: stage.drops,
    })),
  );
  const columns: StepColumn<StageRow>[] = [
    { key: 'group', header: 'Group', cell: (row) => row.group },
    { key: 'stage', header: 'Stage', numeric: true, cell: (row) => row.stage },
    { key: 'drops', header: 'Drops', cell: (row) => <Drops drops={row.drops} lookup={lookup} /> },
  ];
  const total: StageRow | undefined =
    payload.totals.length > 0
      ? { key: 'total', group: 'Total', stage: '', drops: payload.totals }
      : undefined;
  return <StepTable columns={columns} rowKey={(row) => row.key} rows={rows} total={total} />;
}

function pointsText(row: PointRow) {
  const per = row.per ?? 1;
  return (
    <>
      +{count.format(row.points)}
      {per !== 1 && <span className="eg-per"> per {count.format(per)}</span>}
    </>
  );
}

function BestCell({
  row,
  day,
  best,
}: {
  row: PointRow;
  day: number | null;
  best: ReadonlyMap<string, BestDay>;
}) {
  if (row.item_ref === undefined || day === null) return null;
  const entry = best.get(itemRefKey(row.item_ref));
  if (entry === undefined) return null;
  if (entry.days.includes(day)) return <span className="eg-best">BEST DAY</span>;
  return (
    <span className="eg-best-other">
      {entry.days.length === 1 ? 'day' : 'days'} {entry.days.join(', ')}
    </span>
  );
}

function PointTable({
  table,
  best,
  lookup,
}: {
  table: PointTablePayload;
  best: ReadonlyMap<string, BestDay>;
  lookup: Lookup;
}) {
  if (table.rows.length === 0) {
    return <p className="empty">The game lists nothing that scores here.</p>;
  }
  const rows = table.rows.map((row, index) => ({ row, key: row.score_id ?? `r${index}` }));
  type Line = (typeof rows)[number];
  const anyItem = table.rows.some((row) => row.item_ref !== undefined);
  const anyBest =
    table.day !== null &&
    table.rows.some((row) => row.item_ref !== undefined && best.has(itemRefKey(row.item_ref)));
  const columns: StepColumn<Line>[] = [
    { key: 'action', header: 'Action', cell: ({ row }) => row.action },
    ...(anyItem
      ? [
          {
            key: 'item',
            header: 'Item',
            cell: ({ row }: Line) =>
              row.item_ref ? <ItemName item={row.item_ref} lookup={lookup} /> : '—',
          },
        ]
      : []),
    { key: 'points', header: 'Points', numeric: true, cell: ({ row }) => pointsText(row) },
    ...(anyBest
      ? [
          {
            key: 'best',
            header: 'Best',
            cell: ({ row }: Line) => <BestCell best={best} day={table.day} row={row} />,
          },
        ]
      : []),
  ];
  return <StepTable columns={columns} rowKey={(line) => line.key} rows={rows} />;
}

/** The rule a cell states when there is no stock to evaluate it against. */
function prepRule(item: PrepItem): string {
  const parts: string[] = [];
  const each = item.unit === 1 ? 'each' : `per ${count.format(item.unit)}`;
  if (item.per_unit_points !== undefined) {
    parts.push(`${count.format(item.per_unit_points)} pts ${each}`);
  }
  if (item.per_unit_shots !== undefined) {
    parts.push(
      `${count.format(item.per_unit_shots)} ${item.per_unit_shots === 1 ? 'shot' : 'shots'} ${each}`,
    );
  }
  if (item.cap !== undefined) parts.push(`cap ${count.format(item.cap)}`);
  if (item.day !== undefined) parts.push(`day ${item.day}`);
  return parts.join(' · ');
}

/** What the held stock comes to: `→ 309,000 pts on day 2`. */
function prepWorth(line: PrepLine): string | undefined {
  const on = line.item.day !== undefined ? ` on day ${line.item.day}` : '';
  if (line.points !== null) return `→ ${count.format(line.points)} pts${on}`;
  if (line.shots !== null) return `→ ${count.format(line.shots)} shots${on}`;
  return undefined;
}

function Prep({
  payload,
  stock,
  stockReadAt,
  now,
  lookup,
}: {
  payload: PrepPayload;
  stock: Stock | null;
  stockReadAt: string | null;
  now: Date;
  lookup: Lookup;
}) {
  const led = stockLed(stock === null ? null : stockReadAt, now);
  const lines = derivePrep(payload, stock);
  return (
    <>
      <p className="eg-stock">
        <Led tone={led.tone}>{led.text}</Led>
        <span className="eg-stock-note">
          {stock === null
            ? 'With a linked account, each cell shows what you hold and what it is worth.'
            : 'From your newest login the collector saw. A dash means that login did not list the item.'}
        </span>
      </p>
      <CellGrid>
        {lines.map((line) => (
          <Cell
            context={line.held === null ? prepRule(line.item) : prepWorth(line)}
            key={itemRefKey(line.item.item_ref)}
            label={labelOf(line.item.item_ref, lookup)}
            note={line.held === null ? undefined : prepRule(line.item)}
            unit={
              line.held !== null && line.item.cap !== undefined
                ? `/${count.format(line.item.cap)}`
                : undefined
            }
            value={line.held === null ? null : count.format(line.held)}
          />
        ))}
      </CellGrid>
    </>
  );
}

interface SourceLine extends SourceRow {
  key: string;
}

function Sources({ payload }: { payload: SourcesPayload }) {
  const rows: SourceLine[] = payload.rows.map((row, index) => ({ ...row, key: `s${index}` }));
  const columns: StepColumn<SourceLine>[] = [
    { key: 'source', header: 'Source', cell: (row) => row.source },
    { key: 'rate', header: 'Rate', cell: (row) => row.rate },
    {
      key: 'cap',
      header: 'Cap',
      numeric: true,
      cell: (row) => (row.cap === null ? '—' : count.format(row.cap)),
    },
  ];
  const total: SourceLine | undefined =
    payload.total_cap !== null || payload.note !== null
      ? { key: 'total', source: 'Total', rate: payload.note ?? '', cap: payload.total_cap }
      : undefined;
  return <StepTable columns={columns} rowKey={(row) => row.key} rows={rows} total={total} />;
}

function Notes({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return (
    <div className="eg-notes">
      {paragraphs.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one static text
        <p key={index}>{part}</p>
      ))}
    </div>
  );
}
