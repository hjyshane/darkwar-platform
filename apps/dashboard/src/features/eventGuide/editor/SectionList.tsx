import { useState } from 'react';
import type { PickerResult } from '../guideData';
import type { ScoreItemMap } from '../scoreItems';
import { isSectionKind } from '../sections/common';
import {
  type GuideSection,
  SECTION_KINDS,
  type SectionKind,
  type SectionPayload,
  parseSection,
} from '../sections/index';
import type { ItemCatalogue, ItemRef } from '../sections/itemRef';
import { ItemPicker } from './ItemPicker';
import { SectionForm } from './SectionForms';
import { emptyPayload, validateDraft } from './drafts';
import '../guides.css';

export interface SectionSave {
  section_id?: string;
  guide_id: string;
  kind: string;
  title: string | null;
  sort_order: number;
  payload: unknown;
}

export interface SectionListProps {
  /** The guide these sections belong to; a guide with none yet cannot say. */
  guideId: string;
  sections: readonly GuideSection[];
  scoreItems: ScoreItemMap;
  catalogue: ItemCatalogue;
  iconSrc: ReadonlyMap<string, string>;
  /** Whether the viewer holds guide.delete. The database decides either way. */
  canDelete: boolean;
  onSaveSection: (input: SectionSave) => Promise<void>;
  onDeleteSection: (sectionId: string) => Promise<void>;
  onSaveScoreItem: (scoreId: string, ref: ItemRef) => Promise<void>;
  onClearScoreItem: (scoreId: string) => Promise<void>;
  /** Injected for tests; the client rows' item pickers use it. */
  search?: (filter: string) => Promise<PickerResult[]>;
}

const STEP = 10;

/** A section being written, not yet in the table. */
interface NewDraft {
  key: string;
  kind: SectionKind;
}

export function SectionList(props: SectionListProps) {
  const { sections, onSaveSection } = props;
  const { guideId } = props;
  const [drafts, setDrafts] = useState<NewDraft[]>([]);
  const nextOrder = (sections.reduce((top, s) => Math.max(top, s.sort_order), 0) || 0) + STEP;

  return (
    <div className="eg-editor">
      <ul className="eg-section-list">
        {sections.map((section) => (
          <li className="eg-section-item" data-source={section.source} key={section.section_id}>
            {section.source === 'client' ? (
              <ClientSection {...props} section={section} />
            ) : (
              <OfficerSection
                {...props}
                initial={{
                  title: section.title,
                  sort_order: section.sort_order,
                  kind: section.kind,
                  payload: section.payload,
                  section_id: section.section_id,
                  guide_id: section.guide_id,
                }}
              />
            )}
          </li>
        ))}
        {drafts.map((draft) => (
          <li className="eg-section-item" data-source="officer" key={draft.key}>
            <OfficerSection
              {...props}
              initial={{
                title: null,
                sort_order: nextOrder,
                kind: draft.kind,
                payload: emptyPayload(draft.kind),
                guide_id: guideId,
              }}
              onDiscard={() => setDrafts((all) => all.filter((d) => d.key !== draft.key))}
              onSaveSection={async (input) => {
                await onSaveSection(input);
                setDrafts((all) => all.filter((d) => d.key !== draft.key));
              }}
            />
          </li>
        ))}
      </ul>
      <div className="eg-actions">
        <span className="eg-kind">Add a section</span>
        {SECTION_KINDS.map((kind) => (
          <button
            aria-label={`Add ${kind} section`}
            key={kind}
            onClick={() =>
              setDrafts((all) => [...all, { key: `${kind}-${Date.now()}-${all.length}`, kind }])
            }
            type="button"
          >
            {kind.replace('_', ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- client rows

function ClientSection({
  section,
  scoreItems,
  catalogue,
  iconSrc,
  onSaveScoreItem,
  onClearScoreItem,
  onDeleteSection,
  canDelete,
  search,
}: SectionListProps & { section: GuideSection }) {
  const parsed = parseSection(section.kind, section.payload);
  const [message, setMessage] = useState<string | null>(null);
  const run = (work: Promise<void>) =>
    work.then(
      () => setMessage(null),
      (failure: Error) => setMessage(failure.message),
    );

  if (parsed === null || parsed.kind !== 'point_table') {
    return (
      <UnreadableSection
        canDelete={canDelete}
        onDelete={() => onDeleteSection(section.section_id)}
        title={section.title}
      />
    );
  }
  return (
    <>
      <div className="eg-section-head">
        <strong>{section.title ?? 'Imported scores'}</strong>
        <span className="eg-kind">point table · imported</span>
      </div>
      <p className="eg-reason">Written by the importer. Re-import to refresh.</p>
      <div className="eg-rows table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th className="num" scope="col">
                Points
              </th>
              <th scope="col">Item (shared by every event that reuses this score)</th>
            </tr>
          </thead>
          <tbody>
            {parsed.payload.rows.map((row) => (
              <tr key={row.score_id ?? row.action}>
                <td>{row.action}</td>
                <td className="num">{row.points}</td>
                <td>
                  {row.score_id === undefined ? (
                    '—'
                  ) : (
                    <ItemPicker
                      catalogue={catalogue}
                      iconSrc={iconSrc}
                      id={`score-item-${row.score_id}`}
                      onChange={(ref) =>
                        run(
                          ref === null
                            ? onClearScoreItem(row.score_id as string)
                            : onSaveScoreItem(row.score_id as string, ref),
                        )
                      }
                      search={search}
                      value={scoreItems.get(row.score_id)?.item_ref ?? null}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <p className="error">{message}</p>}
    </>
  );
}

// ------------------------------------------------------------ officer rows

interface Initial {
  section_id?: string;
  guide_id: string;
  kind: string;
  title: string | null;
  sort_order: number;
  payload: unknown;
}

function OfficerSection({
  initial,
  catalogue,
  iconSrc,
  canDelete,
  onSaveSection,
  onDeleteSection,
  onDiscard,
}: SectionListProps & { initial: Initial; onDiscard?: () => void }) {
  // A section being written starts from emptyPayload, which need not PARSE
  // (empty notes have no text yet): the form is where it gets valid. A stored
  // section must parse, or the guide leaves it out and so does this form.
  const isNew = initial.section_id === undefined;
  const parsed = isNew ? null : parseSection(initial.kind, initial.payload);
  const kind: SectionKind | null = isNew
    ? isSectionKind(initial.kind)
      ? initial.kind
      : null
    : (parsed?.kind ?? null);
  const [title, setTitle] = useState(initial.title ?? '');
  const [order, setOrder] = useState(String(initial.sort_order));
  const [payload, setPayload] = useState<SectionPayload['payload'] | null>(
    isNew ? (initial.payload as SectionPayload['payload']) : (parsed?.payload ?? null),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  if (kind === null || payload === null) {
    return (
      <UnreadableSection
        canDelete={canDelete && initial.section_id !== undefined}
        onDelete={() => onDeleteSection(initial.section_id as string)}
        title={initial.title}
      />
    );
  }

  // Bound here: `save` below is a hoisted declaration, which TypeScript does
  // not narrow `kind` inside.
  const sectionKind: SectionKind = kind;
  const result = validateDraft(sectionKind, payload);
  const orderNumber = Number(order);
  const orderOk = order.trim() !== '' && Number.isInteger(orderNumber);
  const reason = result.ok ? (orderOk ? null : 'Order must be a whole number.') : result.reason;

  async function save() {
    if (reason !== null) return;
    setBusy(true);
    try {
      await onSaveSection({
        ...(initial.section_id === undefined ? {} : { section_id: initial.section_id }),
        guide_id: initial.guide_id,
        kind: sectionKind,
        title: title.trim() === '' ? null : title.trim(),
        sort_order: orderNumber,
        payload: result.ok ? result.section.payload : payload,
      });
      setMessage({ text: 'Saved.', failed: false });
    } catch (failure) {
      setMessage({ text: `Could not save: ${(failure as Error).message}`, failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (initial.section_id === undefined) {
      onDiscard?.();
      return;
    }
    if (!window.confirm('Delete this section? This cannot be undone.')) return;
    setBusy(true);
    try {
      await onDeleteSection(initial.section_id);
    } catch (failure) {
      setMessage({ text: `Could not delete: ${(failure as Error).message}`, failed: true });
      setBusy(false);
    }
  }

  return (
    <>
      <div className="eg-section-head">
        <span className="eg-kind">{kind.replace('_', ' ')}</span>
        {initial.section_id === undefined && <span className="eg-draft">NEW</span>}
      </div>
      <div className="eg-form-row">
        <label className="eg-field">
          Title (optional)
          <input onChange={(e) => setTitle(e.target.value)} type="text" value={title} />
        </label>
        <label className="eg-field">
          Order
          <input
            inputMode="numeric"
            onChange={(e) => setOrder(e.target.value)}
            type="text"
            value={order}
          />
        </label>
      </div>
      <SectionForm
        catalogue={catalogue}
        iconSrc={iconSrc}
        kind={kind}
        onChange={setPayload}
        payload={payload}
      />
      <div className="eg-actions">
        <button className="primary" disabled={reason !== null || busy} onClick={save} type="button">
          Save section
        </button>
        {(canDelete || initial.section_id === undefined) && (
          <button disabled={busy} onClick={remove} type="button">
            {initial.section_id === undefined ? 'Discard' : 'Delete section'}
          </button>
        )}
        {reason !== null && <span className="eg-reason">{reason}</span>}
        {message && <span className={message.failed ? 'error' : 'eg-reason'}>{message.text}</span>}
      </div>
    </>
  );
}

function UnreadableSection({
  title,
  canDelete,
  onDelete,
}: {
  title: string | null;
  canDelete: boolean;
  onDelete: () => Promise<void>;
}) {
  return (
    <>
      <div className="eg-section-head">
        <strong>{title ?? 'Untitled section'}</strong>
      </div>
      <p className="error">This section cannot be read.</p>
      <p className="eg-reason">
        Its data does not match its kind, so the guide leaves it out. Delete it and write it again.
      </p>
      {canDelete && (
        <div className="eg-actions">
          <button
            onClick={() => {
              if (window.confirm('Delete this section? This cannot be undone.')) void onDelete();
            }}
            type="button"
          >
            Delete section
          </button>
        </div>
      )}
    </>
  );
}
