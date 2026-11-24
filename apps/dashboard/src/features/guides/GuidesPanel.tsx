import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ChannelField } from '../../components/ChannelField';
import { MarkupEditor, TitleField } from '../../components/MarkupEditor';
import { Strip } from '../../components/Strip';
import { Select } from '../../components/ui/Select';
import { useT } from '../../lib/i18n';
import { type Translate, english } from '../../lib/i18n/core';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { guideHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { BoardList } from '../board/BoardList';
import { GUIDES, useBoard } from '../board/board';
import { boardStrip } from '../board/strip';

/** Strategy notes and tips, as a board.
 *
 * It used to render every guide's whole body one after another, which meant three
 * guides filled the screen and a fourth was below the fold. Now it is the shape
 * people know from every forum: titles, author, date, read marks, and a pager —
 * with the body on the post's own page (`#/guides/<id>`), which is also the thing
 * worth sending somebody a link to.
 *
 * The list, the pager, the read marks and the author names are shared with the
 * notice board (`features/board`). What differs is two column names and a label,
 * so it is configured rather than copied.
 */
export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'info', label: 'Information' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'tip', label: 'Tip' },
];

export function categoryLabel(value: string | null, t: Translate = english): string | null {
  if (value === null) {
    return null;
  }
  const label = CATEGORIES.find((entry) => entry.value === value)?.label;
  return label === undefined ? value : t(label);
}

export interface Draft {
  guide_id?: string;
  /** Empty means the channel set for guides in settings (0127, 0133). */
  channels: string[];
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publish: boolean;
  /** Carried so re-saving a published guide keeps its original date rather than
   * moving it to today and jumping it back up the board. */
  published_at: string | null;
}

const EMPTY: Draft = {
  title: '',
  channels: [],
  body: '',
  category: 'tip',
  pinned: false,
  publish: false,
  published_at: null,
};

/** The editor. Label above field, one column — the shape of every form people
 * already use. The body is a `MarkupEditor`, so a member who knows how the arena
 * works does not have to learn a notation before they can say so. */
export function GuideEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  /** Save, and say whether this is the published version. The caller owns the
   * draft, so the flag comes back rather than being written into it here. */
  onSave: (publish: boolean) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const t = useT();
  const formId = useId();
  return (
    <section aria-labelledby="guide-editor-heading">
      <h3 id="guide-editor-heading">
        {draft.guide_id === undefined ? t('New guide') : t('Editing')}
      </h3>
      <div className="form-stack">
        <div className="field">
          <label htmlFor={`${formId}-title`}>{t('Title')}</label>
          <TitleField
            id={`${formId}-title`}
            onChange={(title) => onChange({ ...draft, title })}
            value={draft.title}
          />
        </div>
        <div className="field field-narrow">
          <label htmlFor={`${formId}-kind`}>{t('Kind')}</label>
          <Select
            id={`${formId}-kind`}
            onChange={(chosen) => onChange({ ...draft, category: chosen })}
            value={draft.category}
          >
            {CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {t(entry.label)}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-body`}>{t('Body')}</label>
          <MarkupEditor
            id={`${formId}-body`}
            onChange={(body) => onChange({ ...draft, body })}
            value={draft.body}
          />
        </div>
        <ChannelField
          fallbackLabel={t('Default for guides')}
          id={`${formId}-channel`}
          onChange={(channels) => onChange({ ...draft, channels })}
          value={draft.channels}
        />
        <div className="field-checks">
          <label>
            <input
              checked={draft.pinned}
              onChange={(event) => onChange({ ...draft, pinned: event.target.checked })}
              type="checkbox"
            />
            {t('Pin to the top of every page')}
          </label>
        </div>
        {/* Publishing is a separate ACT from saving, because publishing is what
            posts to Discord: a guide written over two evenings must not announce
            itself twice, or announce half of itself.

            It was a checkbox next to "Pin", above one button called Save. Two
            things were wrong with that. The checkbox is a state and publishing
            is an event — you do not tick "announce this to 94 people", you press
            it. And leaving it unticked was the only way to save work in
            progress, which is a draft feature nobody could find. Now the button
            says which of the two you are doing. */}
        <div className="row">
          {draft.published_at === null ? (
            <>
              <button
                disabled={saving || draft.title.trim() === ''}
                onClick={() => onSave(false)}
                type="button"
              >
                {saving ? t('Saving…') : t('Save draft')}
              </button>
              <button
                className="primary"
                disabled={saving || draft.title.trim() === ''}
                onClick={() => onSave(true)}
                title={t('Visible to the alliance, and posted to Discord')}
                type="button"
              >
                {t('Publish')}
              </button>
            </>
          ) : (
            <>
              <button
                className="primary"
                disabled={saving || draft.title.trim() === ''}
                onClick={() => onSave(true)}
                type="button"
              >
                {saving ? t('Saving…') : t('Save changes')}
              </button>
              {/* Back to a draft. Not a delete — the guide keeps its address and
                  its text, and stops being on the board. Discord keeps whatever
                  it was already told; nothing here can unsay that. */}
              <button disabled={saving} onClick={() => onSave(false)} type="button">
                {t('Unpublish')}
              </button>
            </>
          )}
          <button onClick={onCancel} type="button">
            {t('Cancel')}
          </button>
        </div>
        {draft.published_at === null && (
          <p className="subtle">
            {t(
              'A draft is visible only to people who may write guides. Publishing posts it to Discord.',
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** Save or create. Shared with the post page, so its Edit button and this
 * screen's cannot drift apart on what publishing means. */
export function useSaveGuide(onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: Draft) => {
      const row = {
        title: value.title.trim(),
        body: value.body,
        category: value.category,
        pinned: value.pinned,
        channels: value.channels.length === 0 ? null : value.channels,
        published_at: value.publish ? (value.published_at ?? new Date().toISOString()) : null,
      };
      const { error } =
        value.guide_id === undefined
          ? await supabase.from('guides').insert(row)
          : await supabase.from('guides').update(row).eq('guide_id', value.guide_id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', 'guides'] });
      void queryClient.invalidateQueries({ queryKey: ['post', 'guides'] });
      onDone();
    },
  });
}

export function GuidesPanel() {
  const t = useT();
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayWrite = isAllowed(permissions?.grants, session?.role, 'guide.write');

  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const board = useBoard(GUIDES, page);
  const save = useSaveGuide(() => setDraft(null));

  return (
    <main className="board-screen">
      <section aria-labelledby="guides-heading" className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            GU
          </span>
          <div>
            <h2 id="guides-heading">{t('Guides')}</h2>
            <p className="entity-meta">
              <span>{t('What the alliance worked out')}</span>
              <span>{t('Written by people, not read from the game')}</span>
            </p>
          </div>
        </header>
        {board.data && <Strip cells={boardStrip(board.data, 'guide', new Date(), t)} />}
        <div className="entity-foot">
          <p>
            {t('Everything else in this dashboard is observation; this is the part people wrote.')}
          </p>
          {board.error && (
            <p className="error">
              {t('Could not load the guides: {message}', { message: board.error.message })}
            </p>
          )}
          {save.error && <p className="error">{save.error.message}</p>}
          {mayWrite && draft === null && (
            <button onClick={() => setDraft({ ...EMPTY })} type="button">
              {t('Write a guide')}
            </button>
          )}
        </div>
      </section>

      {draft !== null && (
        <GuideEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onSave={(publish) => save.mutate({ ...draft, publish })}
          saving={save.isPending}
        />
      )}

      <section aria-labelledby="guides-list-heading" className="panel">
        <h3 id="guides-list-heading">{t('All guides')}</h3>
        {board.isPending ? (
          <p className="empty loading">{t('Loading…')}</p>
        ) : board.data === undefined ? null : (
          <BoardList
            data={board.data}
            empty={
              mayWrite
                ? t(
                    'Nothing here yet. Write the first one — a guide is worth more than the same explanation typed into chat four times.',
                  )
                : t('Nothing here yet. An officer can add one.')
            }
            hrefFor={guideHash}
            onGo={setPage}
            tagLabel={(value) => categoryLabel(value, t)}
          />
        )}
      </section>
    </main>
  );
}
