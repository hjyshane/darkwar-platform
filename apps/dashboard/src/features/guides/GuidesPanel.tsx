import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { MarkupEditor } from '../../components/MarkupEditor';
import { RichText } from '../../components/RichText';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';

/** Strategy notes and tips the alliance wrote about itself.
 *
 * The one tab that is not a board the game produced. Everything else in this app
 * is observation; this is what people worked out from it.
 *
 * READING AND WRITING ARE GATED DIFFERENTLY, and the split is 0078's:
 * membership decides whether you can read the board at all — alliance strategy
 * is not public — while a capability decides who may write, because that is the
 * part an alliance changes its mind about. This component asks
 * `usePermissions` only to decide whether to render the editor. RLS refuses the
 * write either way; hiding a control the database would allow is as wrong as
 * showing one it would refuse.
 *
 * DRAFTS ARE VISIBLE TO WRITERS ONLY, enforced in the policy rather than here.
 * The query asks for everything and gets back what the reader may see — the same
 * rule the notices block follows, for the same reason: a filter repeated in the
 * client is a rule with two places to be wrong.
 */
interface Guide {
  guide_id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'info', label: 'Information' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'tip', label: 'Tip' },
];

function categoryLabel(value: string): string {
  return CATEGORIES.find((entry) => entry.value === value)?.label ?? value;
}

async function fetchGuides(): Promise<Guide[]> {
  const { data, error } = await supabase
    .from('guides')
    .select('guide_id, title, body, category, pinned, published_at, created_at, updated_at')
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`guides query failed: ${error.message}`);
  }
  return (data ?? []) as Guide[];
}

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

interface Draft {
  guide_id?: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publish: boolean;
}

const EMPTY: Draft = { title: '', body: '', category: 'tip', pinned: false, publish: false };

/** The editor.
 *
 * Layout is label-above-field in one column, which is what every form people
 * already use looks like. The first version put the title, the kind and the body
 * in a row of bare `<label>`s and it read as a settings screen rather than as
 * somewhere to write.
 *
 * The body is a `MarkupEditor` — a textarea with buttons — because a member who
 * knows how the arena works should not have to learn a notation before they can
 * say so.
 */
function GuideEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const formId = useId();
  return (
    <section aria-labelledby="guide-editor-heading">
      <h3 id="guide-editor-heading">{draft.guide_id === undefined ? 'New guide' : 'Editing'}</h3>
      <div className="form-stack">
        <div className="field">
          <label htmlFor={`${formId}-title`}>Title</label>
          <input
            id={`${formId}-title`}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            value={draft.title}
          />
        </div>
        <div className="field field-narrow">
          <label htmlFor={`${formId}-kind`}>Kind</label>
          <select
            id={`${formId}-kind`}
            onChange={(event) => onChange({ ...draft, category: event.target.value })}
            value={draft.category}
          >
            {CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-body`}>Body</label>
          <MarkupEditor
            id={`${formId}-body`}
            onChange={(body) => onChange({ ...draft, body })}
            value={draft.body}
          />
        </div>
        <div className="field-checks">
          <label>
            <input
              checked={draft.pinned}
              onChange={(event) => onChange({ ...draft, pinned: event.target.checked })}
              type="checkbox"
            />
            Pin to the top
          </label>
          {/* Publishing is a separate act from saving, because publishing is what
              posts to Discord. Somebody writing a long guide over two evenings
              must not announce it twice, or announce half of it. */}
          <label>
            <input
              checked={draft.publish}
              onChange={(event) => onChange({ ...draft, publish: event.target.checked })}
              type="checkbox"
            />
            Published — visible to the alliance, and posted to Discord
          </label>
        </div>
        <div className="row">
          <button disabled={saving || draft.title.trim() === ''} onClick={onSave} type="button">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

export function GuidesPanel() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayWrite = isAllowed(permissions?.grants, session?.role, 'guide.write');
  const mayDelete = isAllowed(permissions?.grants, session?.role, 'guide.delete');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({ queryKey: ['guides'], queryFn: fetchGuides });

  function report(text: string, bad = false): void {
    setFailed(bad);
    setMessage(text);
    void queryClient.invalidateQueries({ queryKey: ['guides'] });
  }

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      const row = {
        title: value.title.trim(),
        body: value.body,
        category: value.category,
        pinned: value.pinned,
        // Set on first publish and left alone afterwards, so the date on a guide
        // is when the alliance first saw it rather than when it was last edited.
        published_at: value.publish
          ? (publishedAt(value.guide_id) ?? new Date().toISOString())
          : null,
      };
      const { error: saveError } =
        value.guide_id === undefined
          ? await supabase.from('guides').insert(row)
          : await supabase.from('guides').update(row).eq('guide_id', value.guide_id);
      if (saveError) {
        throw new Error(saveError.message);
      }
    },
    onSuccess: () => {
      setDraft(null);
      report('Saved.');
    },
    onError: (saveError: Error) => report(saveError.message, true),
  });

  const remove = useMutation({
    mutationFn: async (guideId: string) => {
      const { error: deleteError } = await supabase.from('guides').delete().eq('guide_id', guideId);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
    },
    onSuccess: () => report('Deleted.'),
    onError: (deleteError: Error) => report(deleteError.message, true),
  });

  /** The publish date a guide already has, so re-saving a published guide does
   * not move it to today and jump it back up the list. */
  function publishedAt(guideId: string | undefined): string | null {
    if (guideId === undefined) {
      return null;
    }
    return (data ?? []).find((guide) => guide.guide_id === guideId)?.published_at ?? null;
  }

  if (isPending) {
    return (
      <main>
        <p className="empty">Loading…</p>
      </main>
    );
  }

  const guides = data ?? [];

  return (
    <main>
      <section aria-labelledby="guides-heading">
        <h2 id="guides-heading">Guides</h2>
        <p className="subtle">
          What the alliance worked out, rather than what the game reported. Everything else in this
          dashboard is observation; this is the part people wrote.
        </p>
        {error && <p className="error">Could not load the guides: {error.message}</p>}
        {message !== null && <p className={failed ? 'error' : 'empty'}>{message}</p>}
        {mayWrite && draft === null && (
          <button onClick={() => setDraft({ ...EMPTY })} type="button">
            Write a guide
          </button>
        )}
      </section>

      {draft !== null && (
        <GuideEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onSave={() => save.mutate(draft)}
          saving={save.isPending}
        />
      )}

      {guides.length === 0 ? (
        <section>
          <p className="empty">
            Nothing here yet.{' '}
            {mayWrite
              ? 'Write the first one — a guide is worth more than the same explanation typed into chat four times.'
              : 'An officer can add one.'}
          </p>
        </section>
      ) : (
        guides.map((guide) => (
          <section key={guide.guide_id}>
            <h3>
              {guide.title}
              <span className="subtle">
                {' · '}
                {categoryLabel(guide.category)}
                {guide.pinned && ' · pinned'}
              </span>
              {/* A draft is labelled, not hidden — the only people who can see it
                  are the ones who may write, and they need to know which of their
                  own guides the alliance cannot read yet. */}
              {guide.published_at === null && <span className="badge badge-missing">draft</span>}
            </h3>
            <p className="subtle">
              {guide.published_at === null
                ? `Written ${day.format(new Date(guide.created_at))}`
                : `Published ${day.format(new Date(guide.published_at))}`}
              {guide.updated_at !== guide.created_at &&
                ` · edited ${day.format(new Date(guide.updated_at))}`}
            </p>
            <RichText body={guide.body} />
            {mayWrite && (
              <div className="row">
                <button
                  onClick={() =>
                    setDraft({
                      guide_id: guide.guide_id,
                      title: guide.title,
                      body: guide.body,
                      category: guide.category,
                      pinned: guide.pinned,
                      publish: guide.published_at !== null,
                    })
                  }
                  type="button"
                >
                  Edit
                </button>
                {mayDelete && (
                  <button onClick={() => remove.mutate(guide.guide_id)} type="button">
                    Delete
                  </button>
                )}
              </div>
            )}
          </section>
        ))
      )}
    </main>
  );
}
