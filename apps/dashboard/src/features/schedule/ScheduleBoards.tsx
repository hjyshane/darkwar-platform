import { useId, useState } from 'react';
import {
  type CategoryDraft,
  type ScheduleCategory,
  categoryKey,
  useChannelNames,
  useDeleteCategory,
  useSaveCategory,
} from './schedule';

/** Boards: the kinds of entry on the calendar, and where each one announces.
 *
 * Lives on the schedule screen rather than in admin settings, because writing
 * the calendar is an officer's job (0124) and settings is admin-only. The one
 * thing on this form that is admin-shaped — which Discord channel — is handled
 * by 0125: officers get the channel NAMES, never the webhook URLs.
 *
 * THE KEY IS NEVER SHOWN. It is a primary key that entries point at, derived
 * from the label once and then fixed, so renaming "Bear hunt" to "Bear" keeps
 * every entry already filed under it. Showing it would invite editing it.
 */

const NEW: CategoryDraft = {
  category: '',
  label: '',
  colour: '#c2410c',
  channel: '',
  sort_order: 0,
};

function draftFrom(entry: ScheduleCategory): CategoryDraft {
  return {
    category: entry.category,
    label: entry.label,
    colour: entry.colour ?? '',
    channel: entry.channel ?? '',
    sort_order: entry.sort_order,
  };
}

export function ScheduleBoards({ categories }: { categories: ScheduleCategory[] }) {
  const formId = useId();
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const { data: channels } = useChannelNames();
  const save = useSaveCategory();
  const remove = useDeleteCategory();

  const isNew = draft !== null && draft.category === '';
  const commit = () => {
    if (draft === null) {
      return;
    }
    const key = isNew
      ? categoryKey(
          draft.label,
          categories.map((entry) => entry.category),
        )
      : draft.category;
    save.mutate({ ...draft, category: key }, { onSuccess: () => setDraft(null) });
  };

  return (
    <section aria-labelledby={`${formId}-heading`} className="schedule-editor">
      <h3 id={`${formId}-heading`}>Boards</h3>

      {categories.length === 0 ? (
        <p className="empty">
          No boards yet. An entry without one still appears on the calendar; its reminders fall back
          to the channel set for calendar reminders in Settings.
        </p>
      ) : (
        <ul className="schedule-boards">
          {categories.map((entry) => (
            <li key={entry.category}>
              <span
                aria-hidden="true"
                className="schedule-swatch"
                style={{ background: entry.colour ?? 'var(--border-strong)' }}
              />
              <span className="schedule-board-label">{entry.label}</span>
              <span className="hint">
                {entry.channel === null ? 'Announces nowhere' : `#${entry.channel}`}
              </span>
              <button className="linklike" onClick={() => setDraft(draftFrom(entry))} type="button">
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft === null ? (
        <button onClick={() => setDraft(NEW)} type="button">
          New board
        </button>
      ) : (
        <div className="form-stack">
          <div className="schedule-row">
            <div className="field">
              <label htmlFor={`${formId}-label`}>Name</label>
              <input
                id={`${formId}-label`}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                value={draft.label}
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-colour`}>Colour</label>
              <input
                id={`${formId}-colour`}
                onChange={(e) => setDraft({ ...draft, colour: e.target.value })}
                type="color"
                value={draft.colour === '' ? '#888888' : draft.colour}
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-channel`}>Discord channel</label>
              <select
                id={`${formId}-channel`}
                onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
                value={draft.channel}
              >
                <option value="">Announce nowhere</option>
                {(channels ?? []).map((name) => (
                  <option key={name} value={name}>
                    #{name}
                  </option>
                ))}
                {/* A channel this reader cannot list but the row already
                    carries. Dropping it silently would blank the routing on
                    the next save of an unrelated field. */}
                {draft.channel !== '' && !(channels ?? []).includes(draft.channel) && (
                  <option value={draft.channel}>#{draft.channel}</option>
                )}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-sort`}>Order</label>
              <input
                id={`${formId}-sort`}
                onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
                type="number"
                value={draft.sort_order}
              />
            </div>
          </div>

          {(channels ?? []).length === 0 && (
            <p className="hint">
              No channels are set up yet. An admin adds them under Settings → Notifications; until
              then a board can exist and simply announce nothing.
            </p>
          )}
          {save.error !== null && <p className="error">{(save.error as Error).message}</p>}

          <div className="toolbar">
            <button
              disabled={save.isPending || draft.label.trim() === ''}
              onClick={commit}
              type="button"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setDraft(null)} type="button">
              Cancel
            </button>
            {!isNew && (
              <button
                className="linklike"
                onClick={() => {
                  remove.mutate(draft.category);
                  setDraft(null);
                }}
                type="button"
              >
                Delete
              </button>
            )}
          </div>
          {!isNew && (
            <p className="hint">
              Deleting a board leaves its entries on the calendar with no board — it does not delete
              them.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
