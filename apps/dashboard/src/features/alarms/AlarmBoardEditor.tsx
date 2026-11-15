import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { type AlarmBoard, MESSAGE_MAX, PING_ROLE_ID, pingRole } from './alarmLogic';
import { useDeleteBoard, useSaveBoard, useSavePingRole } from './alarms';
import { removeBoardText } from './boardLogic';

/** One board's settings, for an officer (spec §1, §4, §8): its kind, where its
 * alarms go, the role they ping, when they go out and what they say — and
 * removing it. Split from `AlarmBoardsPanel` when boards gained delete. */

const minutesText = (values: readonly number[]) => values.join(', ');
/** `720, 60 5` → [720, 60, 5]; anything else becomes NaN and `stepMinutes` refuses it. */
const minutesOf = (text: string) =>
  text
    .split(/[\s,]+/)
    .filter((part) => part !== '')
    .map(Number);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface AlarmBoardEditorProps {
  board: AlarmBoard;
  boards: readonly AlarmBoard[];
  channels: readonly string[];
  onDone: () => void;
}

/** "Delete board" / "Stop watching", asked twice: what happens to the board's
 *  entries is said before anything is removed. */
function RemoveBoard({ board, onDone }: { board: AlarmBoard; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = useDeleteBoard();
  const text = removeBoardText(board);

  async function commit() {
    setProblem(null);
    try {
      await remove.mutateAsync(board.category);
      onDone();
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  return (
    <>
      <div className="alarm-actions">
        {confirming ? (
          <>
            <span>{text.confirm}</span>
            <button disabled={remove.isPending} onClick={commit} type="button">
              {text.yes}
            </button>
            <button onClick={() => setConfirming(false)} type="button">
              Cancel
            </button>
          </>
        ) : (
          <button className="linklike" onClick={() => setConfirming(true)} type="button">
            {text.action}
          </button>
        )}
      </div>
      {problem !== null && <p className="error">{problem}</p>}
    </>
  );
}

export function AlarmBoardEditor({ board, boards, channels, onDone }: AlarmBoardEditorProps) {
  const formId = useId();
  const [kind, setKind] = useState(board.kind);
  const [channel, setChannel] = useState(board.channel ?? '');
  const [role, setRole] = useState(board.pingRoleId ?? '');
  const [everyBoard, setEveryBoard] = useState(false);
  const [start, setStart] = useState(minutesText(board.startReminders));
  const [close, setClose] = useState(minutesText(board.closeReminders));
  const [onOpen, setOnOpen] = useState(board.alarmOnOpen);
  const [template, setTemplate] = useState(board.messageTemplate ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveBoard();
  const saveRole = useSavePingRole();
  const roleIsBad = role.trim() !== '' && !PING_ROLE_ID.test(role.trim());

  async function commit() {
    setProblem(null);
    try {
      const pinged = pingRole(role);
      await save.mutateAsync({
        category: board.category,
        kind,
        channel: channel === '' ? null : channel,
        pingRoleId: pinged,
        startReminders: minutesOf(start),
        closeReminders: minutesOf(close),
        alarmOnOpen: onOpen,
        messageTemplate: template,
      });
      if (everyBoard) {
        await saveRole.mutateAsync({
          pingRoleId: pinged,
          categories: boards.map((b) => b.category).filter((c) => c !== board.category),
        });
      }
      onDone();
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  return (
    <div className="alarm-panel">
      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-kind`}>Kind</label>
          <Select
            id={`${formId}-kind`}
            onChange={(value) => setKind(value === 'window' ? 'window' : 'point')}
            value={kind}
          >
            <option value="point">A moment: alarms before it starts</option>
            <option value="window">A window: when it opens and before it closes</option>
          </Select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-channel`}>Discord channel</label>
          <Select id={`${formId}-channel`} onChange={setChannel} value={channel}>
            <option value="">The alliance reminder channel</option>
            {channels.map((name) => (
              <option key={name} value={name}>
                #{name}
              </option>
            ))}
            {/* Kept so an unrelated save does not blank the routing. */}
            {channel !== '' && !channels.includes(channel) && (
              <option value={channel}>#{channel} (switched off)</option>
            )}
          </Select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-role`}>Ping role ID (optional)</label>
          <input
            id={`${formId}-role`}
            inputMode="numeric"
            maxLength={20}
            onChange={(e) => setRole(e.target.value)}
            value={role}
          />
        </div>
        <label>
          <input
            checked={everyBoard}
            onChange={(e) => setEveryBoard(e.target.checked)}
            type="checkbox"
          />{' '}
          Use for every board
        </label>
      </div>
      <p className="subtle">
        In Discord: Settings → Advanced → Developer Mode on, then right-click the role → Copy Role
        ID. Every alarm from this board pings it. Blank for no ping.
      </p>
      {roleIsBad && <p className="error">A role ID is 17 to 20 digits.</p>}

      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-start`}>Minutes before the start</label>
          <input id={`${formId}-start`} onChange={(e) => setStart(e.target.value)} value={start} />
        </div>
        {kind === 'window' && (
          <>
            <label>
              <input
                checked={onOpen}
                onChange={(e) => setOnOpen(e.target.checked)}
                type="checkbox"
              />{' '}
              Alarm when it opens
            </label>
            <div className="field">
              <label htmlFor={`${formId}-close`}>Minutes before it closes</label>
              <input
                id={`${formId}-close`}
                onChange={(e) => setClose(e.target.value)}
                value={close}
              />
            </div>
          </>
        )}
      </div>
      <p className="subtle">
        Comma-separated minutes: 720 is 12 hours, 60 one hour. Up to two weeks (20160).
      </p>

      <div className="field">
        <label htmlFor={`${formId}-template`}>Message (when an entry has none of its own)</label>
        <textarea
          id={`${formId}-template`}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setTemplate(e.target.value)}
          rows={2}
          value={template}
        />
      </div>
      <p className="subtle">
        <code>{'{start}'}</code>, <code>{'{in}'}</code> and <code>{'{end}'}</code> become the
        entry's times, in each member's own zone.
      </p>

      {problem !== null && <p className="error">{problem}</p>}
      <div className="alarm-actions">
        <button
          disabled={save.isPending || saveRole.isPending || roleIsBad}
          onClick={commit}
          type="button"
        >
          {save.isPending || saveRole.isPending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} type="button">
          Cancel
        </button>
      </div>
      <RemoveBoard board={board} onDone={onDone} />
    </div>
  );
}
