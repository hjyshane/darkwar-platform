import { useId } from 'react';
import type { ScheduleCategory, ScheduleDraft } from './schedule';

/** The form behind an entry.
 *
 * REMINDERS ARE THE ONLY UNUSUAL PART. They are minutes before the start, so
 * the field says "60" and means "an hour before" — and moving the entry moves
 * them, which is the reason 0124 stores them that way. The presets exist
 * because typing 1440 for "the day before" is a way to get 144.
 */

const PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'At the start' },
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 1440, label: '1 day' },
];

export function reminderLabel(minutes: number): string {
  const preset = PRESETS.find((entry) => entry.minutes === minutes);
  if (preset !== undefined) {
    return preset.label;
  }
  if (minutes % 1440 === 0) {
    return `${minutes / 1440} days`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60} hours`;
  }
  return `${minutes} min`;
}

export function ScheduleEditor({
  draft,
  categories,
  onChange,
  onSave,
  onCancel,
  onDelete,
  saving,
  error,
}: {
  draft: ScheduleDraft;
  categories: ScheduleCategory[];
  onChange: (next: ScheduleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Absent for a new entry, which has nothing to delete yet. */
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
}) {
  const formId = useId();
  const chosen = categories.find((entry) => entry.category === draft.category);
  const toggle = (minutes: number) =>
    onChange({
      ...draft,
      reminders: draft.reminders.includes(minutes)
        ? draft.reminders.filter((value) => value !== minutes)
        : [...draft.reminders, minutes].sort((a, b) => a - b),
    });

  return (
    <section aria-labelledby={`${formId}-heading`} className="schedule-editor">
      <h3 id={`${formId}-heading`}>
        {draft.schedule_event_id === undefined ? 'New entry' : 'Editing entry'}
      </h3>
      <div className="form-stack">
        <div className="field">
          <label htmlFor={`${formId}-title`}>Title</label>
          <input
            id={`${formId}-title`}
            maxLength={120}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            value={draft.title}
          />
        </div>

        <div className="schedule-row">
          <div className="field">
            <label htmlFor={`${formId}-starts`}>Starts (UTC)</label>
            <input
              id={`${formId}-starts`}
              onChange={(e) => onChange({ ...draft, starts_at: e.target.value })}
              type="datetime-local"
              value={draft.starts_at}
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-ends`}>Ends (UTC, optional)</label>
            <input
              id={`${formId}-ends`}
              onChange={(e) => onChange({ ...draft, ends_at: e.target.value })}
              type="datetime-local"
              value={draft.ends_at}
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-category`}>Board</label>
            <select
              id={`${formId}-category`}
              onChange={(e) => onChange({ ...draft, category: e.target.value })}
              value={draft.category}
            >
              <option value="">None</option>
              {categories.map((entry) => (
                <option key={entry.category} value={entry.category}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${formId}-body`}>Details (optional)</label>
          <textarea
            id={`${formId}-body`}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            rows={3}
            value={draft.body}
          />
        </div>

        <fieldset className="field">
          <legend>Remind Discord</legend>
          <div className="schedule-presets">
            {PRESETS.map((preset) => (
              <button
                aria-pressed={draft.reminders.includes(preset.minutes)}
                className="chip"
                key={preset.minutes}
                onClick={() => toggle(preset.minutes)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {draft.category === ''
              ? 'This entry has no board, so its reminders fall back to the channel set for calendar reminders in Settings.'
              : chosen?.channel == null
                ? `“${chosen?.label ?? draft.category}” has no Discord channel, so nothing will be sent. Set one in Settings.`
                : `Goes to #${chosen.channel}.`}
          </p>
          <p className="hint">
            A reminder missed while the collector was offline is discarded, not sent late.
          </p>
        </fieldset>

        {error !== null && <p className="error">{error}</p>}

        <div className="toolbar">
          <button disabled={saving || draft.title.trim() === ''} onClick={onSave} type="button">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          {onDelete !== undefined && (
            <button className="linklike" onClick={onDelete} type="button">
              Delete
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
