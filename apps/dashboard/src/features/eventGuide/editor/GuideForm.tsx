import { useState } from 'react';
import { Select } from '../../../components/ui/Select';
import type { BoardPost, GuideInput } from '../guideData';
import { type GuideRow, slugify } from '../guides';
import { type GuideFormState, formFromGuide, guideInputFrom } from './guideFields';
import '../guides.css';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const NEW_GUIDE: GuideFormState = {
  title: '',
  title_ko: '',
  slug: '',
  summary: '',
  summary_ko: '',
  published: false,
  post_id: '',
  weekday: '',
  time: '',
  servers: '',
  note: '',
};

export interface GuideFormProps {
  /** Null to write a new guide. */
  guide: GuideRow | null;
  posts: readonly BoardPost[];
  onSave: (input: GuideInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Whether the viewer holds guide.delete; the database decides either way. */
  canDelete: boolean;
}

/** The guide row: title, address, summary, whether members see it, the board
 * post it links, and — for an event the game's calendar does not carry — when
 * it starts. */
export function GuideForm({ guide, posts, onSave, onDelete, canDelete }: GuideFormProps) {
  const [state, setState] = useState<GuideFormState>(guide ? formFromGuide(guide) : NEW_GUIDE);
  // A new guide's address follows its title until somebody edits the address.
  const [slugTouched, setSlugTouched] = useState(guide !== null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const result = guideInputFrom(state, guide?.guide_id);
  const hasActivity = guide?.activity_id != null;

  const set = <K extends keyof GuideFormState>(key: K, value: GuideFormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!result.ok) return;
    setBusy(true);
    try {
      await onSave(result.input);
      setMessage({ text: 'Saved.', failed: false });
    } catch (failure) {
      setMessage({ text: `Could not save: ${(failure as Error).message}`, failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    if (
      !window.confirm(
        'Delete this guide and all its sections? This cannot be undone. Re-importing recreates an imported guide, but not an officer’s sections.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onDelete();
    } catch (failure) {
      setMessage({ text: `Could not delete: ${(failure as Error).message}`, failed: true });
      setBusy(false);
    }
  }

  return (
    <form
      className="eg-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {hasActivity && (
        <p className="eg-reason">
          Imported for activity {guide?.activity_id}. Its start comes from the game’s own calendar.
        </p>
      )}
      <div className="eg-form-row">
        <label className="eg-field">
          Title
          <input
            maxLength={120}
            onChange={(e) => {
              set('title', e.target.value);
              if (!slugTouched) set('slug', slugify(e.target.value));
            }}
            type="text"
            value={state.title}
          />
        </label>
        <label className="eg-field">
          Address
          <input
            maxLength={80}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug', e.target.value);
            }}
            type="text"
            value={state.slug}
          />
        </label>
      </div>
      <label className="eg-field">
        Summary
        <textarea onChange={(e) => set('summary', e.target.value)} value={state.summary} />
      </label>
      <div className="eg-form-row">
        <label className="eg-field">
          Korean title (data only)
          <input
            onChange={(e) => set('title_ko', e.target.value)}
            type="text"
            value={state.title_ko}
          />
        </label>
        <label className="eg-field">
          Korean summary (data only)
          <input
            onChange={(e) => set('summary_ko', e.target.value)}
            type="text"
            value={state.summary_ko}
          />
        </label>
      </div>
      <div className="eg-form-row">
        <label className="eg-field" htmlFor="eg-post">
          Long-form post on the board
        </label>
        <Select id="eg-post" onChange={(value) => set('post_id', value)} value={state.post_id}>
          <option value="">None</option>
          {posts.map((post) => (
            <option key={post.guide_id} value={post.guide_id}>
              {post.title}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="eg-group" disabled={hasActivity}>
        <legend className="eg-kind">When it starts (server time)</legend>
        <p className="eg-reason">
          {hasActivity
            ? 'Not used: the game’s calendar gives this event its times.'
            : 'Used only when the game’s calendar has no time for this event.'}
        </p>
        <div className="eg-form-row">
          <div className="eg-field">
            <span>Weekday</span>
            <Select
              aria-label="Weekday"
              onChange={(value) => set('weekday', value)}
              value={state.weekday}
            >
              <option value="">Not set</option>
              {WEEKDAYS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <label className="eg-field">
            Time
            <input
              onChange={(e) => set('time', e.target.value)}
              placeholder="14:00"
              type="text"
              value={state.time}
            />
          </label>
          <label className="eg-field">
            Servers
            <input
              onChange={(e) => set('servers', e.target.value)}
              placeholder="577-584"
              type="text"
              value={state.servers}
            />
          </label>
          <label className="eg-field">
            Note
            <input onChange={(e) => set('note', e.target.value)} type="text" value={state.note} />
          </label>
        </div>
      </fieldset>

      <label className="eg-check">
        <input
          checked={state.published}
          onChange={(e) => set('published', e.target.checked)}
          type="checkbox"
        />
        Published: members see it in the Guides tab
      </label>

      <div className="eg-actions">
        <button className="primary" disabled={!result.ok || busy} type="submit">
          Save guide
        </button>
        {guide && canDelete && onDelete && (
          <button disabled={busy} onClick={remove} type="button">
            Delete guide
          </button>
        )}
        {!result.ok && <span className="eg-reason">{result.reason}</span>}
        {message && <span className={message.failed ? 'error' : 'eg-reason'}>{message.text}</span>}
      </div>
    </form>
  );
}
