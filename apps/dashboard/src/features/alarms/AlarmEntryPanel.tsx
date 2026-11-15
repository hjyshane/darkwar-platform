import { useId, useState } from 'react';
import { useChannelNames } from '../../lib/channels';
import { fromInputValue, zoneLabel } from '../../lib/timezone';
import { AlarmEntryForm } from './AlarmEntryForm';
import {
  type AlarmBoard,
  type AlarmEntry,
  type AlarmStep,
  type Delivery,
  MESSAGE_MAX,
  backToBoardDefaults,
  chipFor,
  chipText,
  nothingWillBeSent,
  orderSteps,
  previewMessage,
  silenceReason,
  stepKey,
} from './alarmLogic';
import { useHideEntry, useReminderRouting, useSaveEntryAlarms, useSendOnce } from './alarms';

/** One entry's alarms, for an officer (spec §5, §8).
 *
 * THE DRAFT IS NULL UNTIL TOUCHED. Message and steps read straight from the
 * entry until the officer changes one, and go back to reading it after every
 * save. A copy taken when the panel opened would go stale the moment "Send
 * now" filed a one-off — and the next Save would diff it away again.
 *
 * SEND NOW AND SEND LATER SAVE AN EDITED DRAFT FIRST. A one-off carries
 * whatever message is SAVED on the entry when the minute job renders it, so a
 * message typed and sent without saving would go out as the old one. An
 * UNTOUCHED draft is not written back: the cached message may be older than
 * one another officer saved since, and writing it would overwrite theirs.
 */

export interface AlarmEntryPanelProps {
  entry: AlarmEntry;
  board: AlarmBoard | undefined;
  boards: readonly AlarmBoard[];
  deliveries: readonly Delivery[];
  zone: string;
  now: Date;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AlarmEntryPanel({
  entry,
  board,
  boards,
  deliveries,
  zone,
  now,
}: AlarmEntryPanelProps) {
  const formId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [steps, setSteps] = useState<AlarmStep[] | null>(null);
  const [later, setLater] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data: channels } = useChannelNames();
  const { data: routing } = useReminderRouting();
  const save = useSaveEntryAlarms();
  const send = useSendOnce();
  const hide = useHideEntry();

  const text = message ?? entry.alarmMessage ?? '';
  const desired = steps ?? entry.steps;
  const dirty = message !== null || steps !== null;
  const busy = save.isPending || send.isPending || hide.isPending;
  const manual = entry.source === 'manual';
  // Judged only once both answers are in: a channel list still loading is not
  // a channel switched off.
  const silent =
    channels !== undefined &&
    routing !== undefined &&
    nothingWillBeSent(board?.channel ?? null, channels, routing);
  const shown = text.trim() === '' ? (board?.messageTemplate ?? '') : text;

  async function run(action: () => Promise<void>) {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  async function persist() {
    await save.mutateAsync({ entryId: entry.id, message: text, current: entry.steps, desired });
    setMessage(null);
    setSteps(null);
  }

  const toggle = (step: AlarmStep) =>
    setSteps(
      desired.map((s) => (stepKey(s) === stepKey(step) ? { ...s, enabled: !s.enabled } : s)),
    );

  const sendLater = () =>
    run(async () => {
      const at = fromInputValue(later, zone);
      if (at === null) {
        throw new Error('Pick the time to send it.');
      }
      if (Date.parse(at) < Date.now()) {
        throw new Error('That time has already passed.');
      }
      if (dirty) {
        await persist();
      }
      await send.mutateAsync({ entryId: entry.id, at: new Date(at) });
      setLater('');
    });

  return (
    <div className="alarm-panel">
      {silent && (
        <p className="alarm-warn">Nothing will be sent: {silenceReason(board?.channel ?? null)}</p>
      )}

      <div className="field">
        <label htmlFor={`${formId}-message`}>Message on this entry's alarms</label>
        <textarea
          id={`${formId}-message`}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={board?.messageTemplate ?? 'No message: the alarm says only when it starts.'}
          rows={3}
          value={text}
        />
      </div>
      <p className="subtle">
        <code>{'{start}'}</code> the start, <code>{'{in}'}</code> how long until it,{' '}
        <code>{'{end}'}</code> the end. Each member sees them in their own zone, and they follow the
        game when it moves the time. Left blank, the board's message is used.
      </p>
      {shown.trim() !== '' && (
        <p className="alarm-preview">
          Preview ({zoneLabel(zone)}):{' '}
          {previewMessage(shown, entry.startsAt, entry.endsAt, zone, now)}
        </p>
      )}

      <fieldset className="field">
        <legend>Alarms: press one to turn it off or back on</legend>
        {desired.length === 0 ? (
          <p className="subtle">No alarms. Send one below, or go back to the board's.</p>
        ) : (
          <ul className="alarm-chips">
            {orderSteps(desired).map((step) => {
              const chip = chipFor(step, entry, deliveries, now, zone);
              return (
                <li key={stepKey(step)}>
                  <button
                    aria-pressed={step.enabled}
                    className={`alarm-chip alarm-chip-${chip.state}`}
                    onClick={() => toggle(step)}
                    type="button"
                  >
                    {chipText(chip)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="alarm-actions">
        <button disabled={busy || !dirty} onClick={() => run(persist)} type="button">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {board !== undefined && (
          <button
            onClick={() => setSteps(backToBoardDefaults(desired, board))}
            title="The board's steps, all on. One-offs and the message stay."
            type="button"
          >
            Back to board defaults
          </button>
        )}
        {dirty && <span className="subtle">Not saved yet.</span>}
      </div>

      <div className="alarm-actions">
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (dirty) {
                await persist();
              }
              await send.mutateAsync({ entryId: entry.id });
            })
          }
          type="button"
        >
          Send now
        </button>
        <label className="subtle" htmlFor={`${formId}-later`}>
          or at ({zoneLabel(zone)})
        </label>
        <input
          id={`${formId}-later`}
          onChange={(e) => setLater(e.target.value)}
          type="datetime-local"
          value={later}
        />
        <button disabled={busy || later === ''} onClick={sendLater} type="button">
          Send later
        </button>
        <span className="subtle">
          Both save your changes first, then send the saved message to this entry's channel.
        </span>
      </div>

      {problem !== null && <p className="error">{problem}</p>}

      <div className="alarm-actions">
        {manual ? (
          <button className="linklike" onClick={() => setEditing(!editing)} type="button">
            {editing ? 'Stop editing' : 'Edit title and times'}
          </button>
        ) : (
          <span className="subtle">The game sets this entry's times.</span>
        )}
        {confirming ? (
          <>
            <span>
              {manual
                ? 'Delete this entry and its alarms?'
                : 'Hide it? A game entry is hidden, not deleted, because the game would only add it back. Hidden, it leaves this list and sends nothing.'}
            </span>
            <button
              disabled={busy}
              onClick={() => run(async () => hide.mutateAsync(entry))}
              type="button"
            >
              {manual ? 'Yes, delete' : 'Yes, hide'}
            </button>
            <button onClick={() => setConfirming(false)} type="button">
              Cancel
            </button>
          </>
        ) : (
          <button className="linklike" onClick={() => setConfirming(true)} type="button">
            {manual ? 'Delete entry' : 'Hide game entry'}
          </button>
        )}
      </div>

      {manual && editing && (
        <AlarmEntryForm
          boards={boards}
          entry={entry}
          onDone={() => setEditing(false)}
          zone={zone}
        />
      )}
    </div>
  );
}
