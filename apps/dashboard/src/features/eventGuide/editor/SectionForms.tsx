import type {
  Drop,
  NotesPayload,
  PointRow,
  PointTablePayload,
  PrepItem,
  PrepPayload,
  RewardItem,
  RewardsPayload,
  SectionKind,
  SectionPayload,
  SourceRow,
  SourcesPayload,
  Stage,
  StageGroup,
  StagesPayload,
} from '../sections/index';
import type { ItemCatalogue, ItemRef } from '../sections/itemRef';
import { ItemPicker } from './ItemPicker';
import { moveAt, removeAt, setAt } from './drafts';
import { NumberField, RowButtons } from './fields';
import '../guides.css';

// One structured form per section kind (0310). Each is controlled: it draws
// the payload it is given and reports the whole next payload. Nothing is
// validated here — a half-typed row is a draft, and `validateDraft` decides
// whether Save is offered. Required numbers a field may leave blank are
// carried as undefined and fail validation instead of becoming zero.

interface Lookup {
  catalogue: ItemCatalogue;
  iconSrc: ReadonlyMap<string, string>;
}

export interface SectionFormProps extends Lookup {
  kind: SectionKind;
  payload: SectionPayload['payload'];
  onChange: (next: SectionPayload['payload']) => void;
}

export function SectionForm({ kind, payload, onChange, catalogue, iconSrc }: SectionFormProps) {
  const lookup = { catalogue, iconSrc };
  switch (kind) {
    case 'rewards':
      return <RewardsForm {...lookup} onChange={onChange} payload={payload as RewardsPayload} />;
    case 'stages':
      return <StagesForm {...lookup} onChange={onChange} payload={payload as StagesPayload} />;
    case 'point_table':
      return (
        <PointTableForm {...lookup} onChange={onChange} payload={payload as PointTablePayload} />
      );
    case 'prep':
      return <PrepForm {...lookup} onChange={onChange} payload={payload as PrepPayload} />;
    case 'sources':
      return <SourcesForm onChange={onChange} payload={payload as SourcesPayload} />;
    case 'notes':
      return <NotesForm onChange={onChange} payload={payload as NotesPayload} />;
  }
}

/** `item` with `key` set, or removed when the value is undefined: a cleared
 * optional field must not be saved as `cap: undefined` or as zero. */
function withField<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined,
): T {
  const next = { ...item };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** A required number the field may have left blank. */
const blank = (value: number | undefined) => value as number;

function emptyText(value: string): string | null {
  return value === '' ? null : value;
}

// ----------------------------------------------------------------- rewards

function RewardsForm({
  payload,
  onChange,
  catalogue,
  iconSrc,
}: Lookup & { payload: RewardsPayload; onChange: (next: RewardsPayload) => void }) {
  const set = (items: RewardItem[]) => onChange({ items });
  return (
    <div className="eg-rows table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">How it is earned</th>
            <th scope="col">Item (optional)</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {payload.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
            <tr key={index}>
              <td>
                <input
                  aria-label={`Name, reward ${index + 1}`}
                  onChange={(e) =>
                    set(setAt(payload.items, index, { ...item, label: e.target.value }))
                  }
                  type="text"
                  value={item.label}
                />
              </td>
              <td>
                <input
                  aria-label={`Kind, reward ${index + 1}`}
                  onChange={(e) =>
                    set(setAt(payload.items, index, { ...item, kind: e.target.value }))
                  }
                  placeholder="skin, title, frame…"
                  type="text"
                  value={item.kind}
                />
              </td>
              <td>
                <input
                  aria-label={`How, reward ${index + 1}`}
                  onChange={(e) =>
                    set(setAt(payload.items, index, { ...item, how: e.target.value }))
                  }
                  type="text"
                  value={item.how}
                />
              </td>
              <td>
                <ItemPicker
                  catalogue={catalogue}
                  iconSrc={iconSrc}
                  id={`reward-item-${index}`}
                  onChange={(ref) => set(setAt(payload.items, index, { ...item, item_ref: ref }))}
                  value={item.item_ref}
                />
              </td>
              <td>
                <RowButtons
                  index={index}
                  length={payload.items.length}
                  noun="reward"
                  onMove={(delta) => set(moveAt(payload.items, index, delta))}
                  onRemove={() => set(removeAt(payload.items, index))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() =>
          set([...payload.items, { item_ref: null, label: '', kind: '', how: '' } as RewardItem])
        }
        type="button"
      >
        Add reward
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ stages

function DropList({
  drops,
  onChange,
  label,
  catalogue,
  iconSrc,
}: Lookup & { drops: Drop[]; onChange: (next: Drop[]) => void; label: string }) {
  return (
    <div className="eg-rows">
      {drops.map((drop, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
        <div className="eg-pick-chosen" key={index}>
          <ItemPicker
            catalogue={catalogue}
            iconSrc={iconSrc}
            id={`${label}-drop-${index}`}
            onChange={(ref: ItemRef | null) =>
              onChange(setAt(drops, index, { ...drop, item_ref: ref as ItemRef }))
            }
            value={drop.item_ref}
          />
          <NumberField
            label={`Quantity, ${label} drop ${index + 1}`}
            onChange={(qty) => onChange(setAt(drops, index, { ...drop, qty: blank(qty) }))}
            value={drop.qty}
          />
          <button
            aria-label={`Remove ${label} drop ${index + 1}`}
            onClick={() => onChange(removeAt(drops, index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([...drops, { item_ref: undefined, qty: undefined } as unknown as Drop])
        }
        type="button"
      >
        Add drop
      </button>
    </div>
  );
}

function StagesForm({
  payload,
  onChange,
  catalogue,
  iconSrc,
}: Lookup & { payload: StagesPayload; onChange: (next: StagesPayload) => void }) {
  const lookup = { catalogue, iconSrc };
  const setGroups = (groups: StageGroup[]) => onChange({ ...payload, groups });
  return (
    <div className="eg-rows">
      {payload.groups.map((group, g) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: groups are edited in place by position
        <div className="eg-group" key={g}>
          <label className="eg-field">
            Group name
            <input
              aria-label={`Name, group ${g + 1}`}
              onChange={(e) =>
                setGroups(setAt(payload.groups, g, { ...group, label: e.target.value }))
              }
              type="text"
              value={group.label}
            />
          </label>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Drops</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {group.stages.map((stage: Stage, s) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
                  <tr key={s}>
                    <td>
                      <NumberField
                        label={`Stage number, group ${g + 1} row ${s + 1}`}
                        onChange={(n) =>
                          setGroups(
                            setAt(payload.groups, g, {
                              ...group,
                              stages: setAt(group.stages, s, { ...stage, n: blank(n) }),
                            }),
                          )
                        }
                        value={stage.n}
                      />
                    </td>
                    <td>
                      <DropList
                        {...lookup}
                        drops={stage.drops}
                        label={`group ${g + 1} stage ${s + 1}`}
                        onChange={(drops) =>
                          setGroups(
                            setAt(payload.groups, g, {
                              ...group,
                              stages: setAt(group.stages, s, { ...stage, drops }),
                            }),
                          )
                        }
                      />
                    </td>
                    <td>
                      <RowButtons
                        index={s}
                        length={group.stages.length}
                        noun={`stage in group ${g + 1}`}
                        onMove={(delta) =>
                          setGroups(
                            setAt(payload.groups, g, {
                              ...group,
                              stages: moveAt(group.stages, s, delta),
                            }),
                          )
                        }
                        onRemove={() =>
                          setGroups(
                            setAt(payload.groups, g, {
                              ...group,
                              stages: removeAt(group.stages, s),
                            }),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="eg-actions">
            <button
              onClick={() =>
                setGroups(
                  setAt(payload.groups, g, {
                    ...group,
                    stages: [...group.stages, { n: undefined, drops: [] } as unknown as Stage],
                  }),
                )
              }
              type="button"
            >
              Add stage
            </button>
            <button
              aria-label={`Remove group ${g + 1}`}
              onClick={() => setGroups(removeAt(payload.groups, g))}
              type="button"
            >
              Remove group
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => setGroups([...payload.groups, { label: '', stages: [] }])}
        type="button"
      >
        Add group
      </button>
      <fieldset className="eg-group">
        <legend className="eg-kind">Totals row</legend>
        <DropList
          {...lookup}
          drops={payload.totals}
          label="total"
          onChange={(totals) => onChange({ ...payload, totals })}
        />
      </fieldset>
    </div>
  );
}

// ------------------------------------------------------------- point table

function PointTableForm({
  payload,
  onChange,
  catalogue,
  iconSrc,
}: Lookup & { payload: PointTablePayload; onChange: (next: PointTablePayload) => void }) {
  const setRows = (rows: PointRow[]) => onChange({ ...payload, rows });
  return (
    <div className="eg-rows">
      <div className="eg-form-row">
        <div className="eg-field">
          <span>Day</span>
          <NumberField
            label="Day"
            onChange={(day) => onChange({ ...payload, day: day === undefined ? null : day })}
            value={payload.day}
          />
        </div>
        <label className="eg-field">
          Theme
          <input
            onChange={(e) => onChange({ ...payload, theme: emptyText(e.target.value) })}
            type="text"
            value={payload.theme ?? ''}
          />
        </label>
      </div>
      <p className="eg-reason">Leave Day empty for a theme that is not tied to one day.</p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Points</th>
              <th scope="col">Per</th>
              <th scope="col">Item (optional)</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Action, row ${index + 1}`}
                    onChange={(e) =>
                      setRows(setAt(payload.rows, index, { ...row, action: e.target.value }))
                    }
                    type="text"
                    value={row.action}
                  />
                </td>
                <td>
                  <NumberField
                    label={`Points, row ${index + 1}`}
                    onChange={(points) =>
                      setRows(setAt(payload.rows, index, { ...row, points: blank(points) }))
                    }
                    value={row.points}
                  />
                </td>
                <td>
                  <NumberField
                    label={`Per, row ${index + 1}`}
                    onChange={(per) =>
                      setRows(setAt(payload.rows, index, withField(row, 'per', per)))
                    }
                    value={row.per}
                  />
                </td>
                <td>
                  <ItemPicker
                    catalogue={catalogue}
                    iconSrc={iconSrc}
                    id={`point-item-${index}`}
                    onChange={(ref) =>
                      setRows(
                        setAt(payload.rows, index, withField(row, 'item_ref', ref ?? undefined)),
                      )
                    }
                    value={row.item_ref}
                  />
                </td>
                <td>
                  <RowButtons
                    index={index}
                    length={payload.rows.length}
                    noun="row"
                    onMove={(delta) => setRows(moveAt(payload.rows, index, delta))}
                    onRemove={() => setRows(removeAt(payload.rows, index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() =>
          setRows([...payload.rows, { action: '', points: undefined } as unknown as PointRow])
        }
        type="button"
      >
        Add row
      </button>
    </div>
  );
}

// -------------------------------------------------------------------- prep

function PrepForm({
  payload,
  onChange,
  catalogue,
  iconSrc,
}: Lookup & { payload: PrepPayload; onChange: (next: PrepPayload) => void }) {
  const set = (items: PrepItem[]) => onChange({ items });
  const edit = <K extends keyof PrepItem>(
    index: number,
    item: PrepItem,
    key: K,
    value: PrepItem[K] | undefined,
  ) => set(setAt(payload.items, index, withField(item, key, value)));
  return (
    <div className="eg-rows table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Unit</th>
            <th scope="col">Points each</th>
            <th scope="col">Shots each</th>
            <th scope="col">Cap</th>
            <th scope="col">Day</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {payload.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
            <tr key={index}>
              <td>
                <ItemPicker
                  catalogue={catalogue}
                  iconSrc={iconSrc}
                  id={`prep-item-${index}`}
                  onChange={(ref) =>
                    set(setAt(payload.items, index, { ...item, item_ref: ref as ItemRef }))
                  }
                  value={item.item_ref}
                />
              </td>
              <td>
                <NumberField
                  label={`Unit, row ${index + 1}`}
                  onChange={(unit) => edit(index, item, 'unit', blank(unit))}
                  value={item.unit}
                />
              </td>
              <td>
                <NumberField
                  label={`Points each, row ${index + 1}`}
                  onChange={(v) => edit(index, item, 'per_unit_points', v)}
                  value={item.per_unit_points}
                />
              </td>
              <td>
                <NumberField
                  label={`Shots each, row ${index + 1}`}
                  onChange={(v) => edit(index, item, 'per_unit_shots', v)}
                  value={item.per_unit_shots}
                />
              </td>
              <td>
                <NumberField
                  label={`Cap, row ${index + 1}`}
                  onChange={(v) => edit(index, item, 'cap', v)}
                  value={item.cap}
                />
              </td>
              <td>
                <NumberField
                  label={`Day, row ${index + 1}`}
                  onChange={(v) => edit(index, item, 'day', v)}
                  value={item.day}
                />
              </td>
              <td>
                <RowButtons
                  index={index}
                  length={payload.items.length}
                  noun="row"
                  onMove={(delta) => set(moveAt(payload.items, index, delta))}
                  onRemove={() => set(removeAt(payload.items, index))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="eg-reason">
        Unit is how many of the item make one scored unit (1 for a shard, 1000 for a resource scored
        per thousand).
      </p>
      <button
        onClick={() =>
          set([...payload.items, { item_ref: undefined, unit: 1 } as unknown as PrepItem])
        }
        type="button"
      >
        Add row
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- sources

function SourcesForm({
  payload,
  onChange,
}: {
  payload: SourcesPayload;
  onChange: (next: SourcesPayload) => void;
}) {
  const setRows = (rows: SourceRow[]) => onChange({ ...payload, rows });
  return (
    <div className="eg-rows">
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Rate</th>
              <th scope="col">Cap</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Source, row ${index + 1}`}
                    onChange={(e) =>
                      setRows(setAt(payload.rows, index, { ...row, source: e.target.value }))
                    }
                    type="text"
                    value={row.source}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Rate, row ${index + 1}`}
                    onChange={(e) =>
                      setRows(setAt(payload.rows, index, { ...row, rate: e.target.value }))
                    }
                    type="text"
                    value={row.rate}
                  />
                </td>
                <td>
                  <NumberField
                    label={`Cap, row ${index + 1}`}
                    onChange={(cap) =>
                      setRows(
                        setAt(payload.rows, index, { ...row, cap: cap === undefined ? null : cap }),
                      )
                    }
                    value={row.cap}
                  />
                </td>
                <td>
                  <RowButtons
                    index={index}
                    length={payload.rows.length}
                    noun="row"
                    onMove={(delta) => setRows(moveAt(payload.rows, index, delta))}
                    onRemove={() => setRows(removeAt(payload.rows, index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => setRows([...payload.rows, { source: '', rate: '', cap: null }])}
        type="button"
      >
        Add row
      </button>
      <div className="eg-form-row">
        <div className="eg-field">
          <span>Total cap</span>
          <NumberField
            label="Total cap"
            onChange={(total) =>
              onChange({ ...payload, total_cap: total === undefined ? null : total })
            }
            value={payload.total_cap}
          />
        </div>
        <label className="eg-field">
          Note
          <input
            onChange={(e) => onChange({ ...payload, note: emptyText(e.target.value) })}
            type="text"
            value={payload.note ?? ''}
          />
        </label>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- notes

function NotesForm({
  payload,
  onChange,
}: {
  payload: NotesPayload;
  onChange: (next: NotesPayload) => void;
}) {
  return (
    <div className="eg-rows">
      <label className="eg-field">
        Text
        <textarea
          aria-label="Text"
          onChange={(e) => onChange({ ...payload, text: e.target.value })}
          value={payload.text}
        />
      </label>
      <p className="eg-reason">A blank line starts a new paragraph.</p>
      <label className="eg-field">
        Korean text (data only)
        <textarea
          onChange={(e) => onChange({ ...payload, text_ko: emptyText(e.target.value) })}
          value={payload.text_ko ?? ''}
        />
      </label>
    </div>
  );
}
