import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { MarkupEditor, TitleField } from '../../components/MarkupEditor';
import { noticeHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { BoardList } from '../board/BoardList';
import { NOTICES, useBoard } from '../board/board';

/** Notices, as a board.
 *
 * Same shape as the guides board, and for the same reason: a notice is worth
 * linking to on its own. The landing screen now shows only the pinned ones, so
 * this is where the rest of them live — including the ones that have expired,
 * which the overview stops showing but which somebody still has to be able to
 * find.
 *
 * The editor moved here from admin settings. Writing a notice is not configuring
 * the dashboard; it belongs on the board it appears on, next to the notices it
 * will sit among. Writing is still admin-only — that is RLS on `announcements`,
 * not this file.
 */
export interface NoticeDraft {
  announcement_id?: string;
  title: string;
  body: string;
  starts_at: string;
  ends_at: string;
  pinned: boolean;
  visibility: 'public' | 'member';
  /** Whether this save is the published version. Set by the button that was
   * pressed rather than held in the form, because publishing is an act. */
  publish: boolean;
  /** Carried so re-saving a posted notice keeps its original date rather than
   * moving it to today, jumping it up the board and re-announcing it. */
  published_at: string | null;
}

const EMPTY: NoticeDraft = {
  title: '',
  body: '',
  starts_at: '',
  ends_at: '',
  pinned: false,
  visibility: 'member',
  publish: false,
  published_at: null,
};

export function visibilityLabel(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value === 'public' ? 'Anyone' : 'Alliance only';
}

/** `datetime-local` gives no zone, and the column is timestamptz. Read as UTC
 * rather than as the admin's own clock: a notice about a 02:00 UTC reset typed by
 * someone in Seoul must not land nine hours out. */
export function toIso(local: string): string | null {
  return local.trim() === '' ? null : new Date(`${local}:00Z`).toISOString();
}

export function toLocal(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 16);
}

export function NoticeEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: NoticeDraft;
  onChange: (next: NoticeDraft) => void;
  /** Save, and say whether this is the posted version. The caller owns the
   * draft, so the flag comes back rather than being written into it here. */
  onSave: (publish: boolean) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const formId = useId();
  return (
    <section aria-labelledby="notice-editor-heading">
      <h3 id="notice-editor-heading">
        {draft.announcement_id === undefined ? 'New notice' : 'Editing'}
      </h3>
      <div className="form-stack">
        <div className="field">
          <label htmlFor={`${formId}-title`}>Title</label>
          <TitleField
            id={`${formId}-title`}
            onChange={(title) => onChange({ ...draft, title })}
            value={draft.title}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-body`}>Body</label>
          {/* The same editor as guides, so the toolbar means the same thing on
              both boards and the body renders through the same safe subset. */}
          <MarkupEditor
            id={`${formId}-body`}
            onChange={(body) => onChange({ ...draft, body })}
            value={draft.body}
          />
        </div>
        <div className="row">
          <div className="field field-narrow">
            <label htmlFor={`${formId}-from`}>From (UTC)</label>
            <input
              id={`${formId}-from`}
              onChange={(event) => onChange({ ...draft, starts_at: event.target.value })}
              type="datetime-local"
              value={draft.starts_at}
            />
          </div>
          <div className="field field-narrow">
            <label htmlFor={`${formId}-to`}>To (UTC)</label>
            <input
              id={`${formId}-to`}
              onChange={(event) => onChange({ ...draft, ends_at: event.target.value })}
              type="datetime-local"
              value={draft.ends_at}
            />
          </div>
          <div className="field field-narrow">
            <label htmlFor={`${formId}-vis`}>Who sees it</label>
            <select
              id={`${formId}-vis`}
              onChange={(event) =>
                onChange({ ...draft, visibility: event.target.value as NoticeDraft['visibility'] })
              }
              value={draft.visibility}
            >
              <option value="member">Alliance only</option>
              <option value="public">Anyone</option>
            </select>
          </div>
        </div>
        <div className="field-checks">
          <label>
            <input
              checked={draft.pinned}
              onChange={(event) => onChange({ ...draft, pinned: event.target.checked })}
              type="checkbox"
            />
            Pin it — pinned notices are the only ones the landing screen shows
          </label>
        </div>
        {/* Both dates are optional. A notice with neither is a standing one,
            which is the common case and should not require picking a date. */}
        <p className="subtle">
          Leave the dates empty for a standing notice. Times are UTC, the same clock the game week
          resets on.
        </p>
        {/* Posting is a separate ACT from saving, for the reason #196 split the
            guide editor's one button in two: posting is what reaches Discord,
            and a notice typed in two sittings must not announce itself twice or
            announce half of itself. A notice had no draft state at all until
            0108 — saving WAS posting — so this is the first version of this
            screen where closing the tab mid-sentence is safe. */}
        <div className="row">
          {draft.published_at === null ? (
            <>
              <button
                disabled={saving || draft.title.trim() === ''}
                onClick={() => onSave(false)}
                type="button"
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                className="primary"
                disabled={saving || draft.title.trim() === ''}
                onClick={() => onSave(true)}
                title="On the board, and posted to Discord"
                type="button"
              >
                Post notice
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
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {/* Back to a draft. Not a delete — the notice keeps its address
                  and its text, and comes off the board. Discord keeps whatever
                  it was already told; nothing here can unsay that. */}
              {/* "Unpublish" rather than "Unpost", which would match the button
                  opposite. The guide editor says Unpublish and the two boards
                  are meant to work the same way; matching the sibling screen is
                  worth more than matching the verb beside it. */}
              <button disabled={saving} onClick={() => onSave(false)} type="button">
                Unpublish
              </button>
            </>
          )}
          <button onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
        {draft.published_at === null && (
          <p className="subtle">
            A draft is visible only to people who may post a notice. Posting puts it on the board
            and in Discord.
          </p>
        )}
      </div>
    </section>
  );
}

/** Save or create. Shared with the post page so its Edit button cannot drift. */
export function useSaveNotice(onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: NoticeDraft) => {
      const row = {
        title: value.title.trim(),
        body: value.body,
        starts_at: toIso(value.starts_at),
        ends_at: toIso(value.ends_at),
        pinned: value.pinned,
        visibility: value.visibility,
        // Kept, not restamped, when a posted notice is edited: a new timestamp
        // would jump it back up the board and give the notifier a new outbox
        // key, which is a second post to everybody over a corrected typo.
        published_at: value.publish ? (value.published_at ?? new Date().toISOString()) : null,
      };
      // created_by is stamped by a trigger and never sent from here (0034).
      const { error } =
        value.announcement_id === undefined
          ? await supabase.from('announcements').insert(row)
          : await supabase
              .from('announcements')
              .update(row)
              .eq('announcement_id', value.announcement_id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', 'announcements'] });
      void queryClient.invalidateQueries({ queryKey: ['post', 'announcements'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      onDone();
    },
  });
}

export function NoticesPanel() {
  const { data: session } = useSession();
  const mayWrite = session?.role === 'admin';
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<NoticeDraft | null>(null);
  const board = useBoard(NOTICES, page);
  const save = useSaveNotice(() => setDraft(null));

  return (
    <main>
      <section aria-labelledby="notices-heading">
        <h2 id="notices-heading">Notices</h2>
        <p className="subtle">
          Everything an admin has posted, including notices whose window has passed. The landing
          screen shows only the pinned ones.
        </p>
        {board.error && <p className="error">Could not load the notices: {board.error.message}</p>}
        {save.error && <p className="error">{save.error.message}</p>}
        {mayWrite && draft === null && (
          <button onClick={() => setDraft({ ...EMPTY })} type="button">
            Post a notice
          </button>
        )}
      </section>

      {draft !== null && (
        <NoticeEditor
          draft={draft}
          onCancel={() => setDraft(null)}
          onChange={setDraft}
          onSave={(publish) => save.mutate({ ...draft, publish })}
          saving={save.isPending}
        />
      )}

      <section aria-labelledby="notices-list-heading">
        <h3 id="notices-list-heading">All notices</h3>
        {board.isPending ? (
          <p className="empty">Loading…</p>
        ) : board.data === undefined ? null : (
          <BoardList
            data={board.data}
            empty="Nothing posted yet."
            hrefFor={noticeHash}
            onGo={setPage}
            tagHeading="Who sees it"
            tagLabel={visibilityLabel}
          />
        )}
      </section>
    </main>
  );
}
