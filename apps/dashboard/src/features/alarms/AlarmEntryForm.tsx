import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { fromInputValue } from '../../lib/timezone';
import { type AlarmBoard, type AlarmEntry, toLocal } from './alarmLogic';
import { useAddEntry, useEditEntry } from './alarms';

/** A manual entry: added here, or its title and times changed.
 *
 * THE ONLY WAY TO ADD ONE. The Schedule screen this tab replaced was where
 * entries were typed in, and a manual entry is how Server Clash is covered
 * until the game calendar lists it (spec, non-goals). The board is chosen once,
 * at creation: its steps are copied onto the entry then (0322's trigger), so
 * moving the entry to another board later would leave the old board's steps.
 *
 * The fields are wall clocks in the reader's zone; the database stores the
 * instant. A captured entry gets its times locked on save (0344), so the game
 * stops putting them back; its title stays the game's.
 */

export interface AlarmEntryFormProps {
  boards: readonly AlarmBoard[];
  zone: string;
  /** The manual entry being edited; absent to add one. */
  entry?: AlarmEntry;
  onDone: () => void;
}

export function AlarmEntryForm({ boards, zone, entry, onDone }: AlarmEntryFormProps) {
  const formId = useId();
  const [title, setTitle] = useState(entry?.title ?? '');
  const [category, setCategory] = useState(entry?.category ?? boards[0]?.category ?? '');
  const [starts, setStarts] = useState(entry === undefined ? '' : toLocal(entry.startsAt, zone));
  const [ends, setEnds] = useState(entry === undefined ? '' : toLocal(entry.endsAt, zone));
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAddEntry();
  const edit = useEditEntry();
  const busy = add.isPending || edit.isPending;

  async function submit() {
    setProblem(null);
    // An empty start reaches `checkEntry` as '' and is refused there by name.
    const draft = {
      title,
      startsAt: fromInputValue(starts, zone) ?? '',
      endsAt: fromInputValue(ends, zone),
    };
    try {
      if (entry === undefined) {
        await add.mutateAsync({ ...draft, category: category === '' ? null : category });
      } else {
        await edit.mutateAsync({ ...draft, entry });
      }
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="alarm-panel">
      <h3 id={`${formId}-heading`}>{entry === undefined ? 'Add an entry' : 'Edit the entry'}</h3>
      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-title`}>Title</label>
          <input
            disabled={entry !== undefined && entry.source !== 'manual'}
            id={`${formId}-title`}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
        </div>
        {entry === undefined && (
          <div className="field">
            <label htmlFor={`${formId}-board`}>Board</label>
            <Select id={`${formId}-board`} onChange={setCategory} value={category}>
              {boards.map((board) => (
                <option key={board.category} value={board.category}>
                  {board.label}
                </option>
              ))}
              <option value="">No board (no alarms)</option>
            </Select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${formId}-starts`}>Starts</label>
          <input
            id={`${formId}-starts`}
            onChange={(e) => setStarts(e.target.value)}
            type="datetime-local"
            value={starts}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-ends`}>Ends (optional)</label>
          <input
            id={`${formId}-ends`}
            onChange={(e) => setEnds(e.target.value)}
            type="datetime-local"
            value={ends}
          />
        </div>
      </div>
      <p className="subtle">
        Times are in the zone picked above.
        {entry !== undefined &&
          entry.source !== 'manual' &&
          ' Changing a game entry’s times keeps them: the game stops moving this entry until you hand it back.'}
        {entry === undefined && ' The entry gets its board’s alarms when it is saved.'}
      </p>
      {problem !== null && <p className="error">{problem}</p>}
      <div className="alarm-actions">
        <button disabled={busy} onClick={submit} type="button">
          {busy ? 'Saving…' : entry === undefined ? 'Add' : 'Save'}
        </button>
        <button onClick={onDone} type="button">
          Cancel
        </button>
      </div>
    </section>
  );
}
