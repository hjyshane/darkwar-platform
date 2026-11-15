import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { useChannelNames } from '../../lib/channels';
import {
  type AlarmBoard,
  MESSAGE_MAX,
  PING_ROLE_ID,
  boardDefaultSteps,
  nothingWillBeSent,
  pingRole,
  shortDate,
  silenceReason,
  stepLabel,
} from './alarmLogic';
import {
  useGameEventsForServer,
  useReminderRouting,
  useSaveBoard,
  useSavePingRole,
  useWatchGameEvent,
} from './alarms';

/** Boards, for an officer (spec §1, §4, §8): each kind of event, where its
 * alarms go, the role they ping, when they go out and what they say.
 *
 * A CHANGE HERE REACHES ENTRIES FILED AFTERWARDS ONLY. 0322 copies a board's
 * steps onto an entry when it is filed, so the entries already listed keep
 * theirs; "Back to board defaults" on one brings it up to date.
 */

const minutesText = (values: readonly number[]) => values.join(', ');
/** `720, 60 5` → [720, 60, 5]; anything else becomes NaN and `stepMinutes` refuses it. */
const minutesOf = (text: string) =>
  text
    .split(/[\s,]+/)
    .filter((part) => part !== '')
    .map(Number);

interface EditorProps {
  board: AlarmBoard;
  boards: readonly AlarmBoard[];
  channels: readonly string[];
  onDone: () => void;
}

function BoardEditor({ board, boards, channels, onDone }: EditorProps) {
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
      setProblem(error instanceof Error ? error.message : String(error));
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
    </div>
  );
}

/** "Watch a game event" (spec §3): a window board following one activity of
 * the game calendar, which 0325 then files entries for. Season events change
 * every season, so they are picked here rather than seeded. */
function WatchGameEvent({
  boards,
  serverId,
  zone,
}: { boards: readonly AlarmBoard[]; serverId: number; zone: string }) {
  const formId = useId();
  const [chosen, setChosen] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const events = useGameEventsForServer(serverId);
  const watch = useWatchGameEvent();
  const watched = new Set(boards.map((board) => board.activityId));
  // One option per activity: the calendar lists an activity once per window.
  const offered = [
    ...new Map(
      (events.data ?? [])
        .filter((event) => !watched.has(event.activityId))
        .map((event) => [event.activityId, event]),
    ).values(),
  ];
  const picked = offered.find((event) => event.activityId === chosen);

  async function commit() {
    if (picked === undefined) {
      return;
    }
    setProblem(null);
    try {
      await watch.mutateAsync({ activityId: picked.activityId, name: picked.name ?? '' });
      setChosen('');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="alarm-panel">
      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-event`}>Watch a game event</label>
          <Select id={`${formId}-event`} onChange={setChosen} value={chosen}>
            <option value="">
              {offered.length === 0 ? 'Nothing new in the game calendar' : 'Pick an event'}
            </option>
            {offered.map((event) => (
              <option key={event.activityId} value={event.activityId}>
                {`${event.name ?? `Event ${event.activityId}`}${event.startsAt === null ? '' : `, ${shortDate(event.startsAt, zone)}`}`}
              </option>
            ))}
          </Select>
        </div>
        <button disabled={picked === undefined || watch.isPending} onClick={commit} type="button">
          Watch
        </button>
      </div>
      <p className="subtle">
        Makes a window board for it: an alarm when it opens and before it closes, each time the game
        lists it.
      </p>
      {problem !== null && <p className="error">{problem}</p>}
    </div>
  );
}

export interface AlarmBoardsPanelProps {
  boards: readonly AlarmBoard[];
  /** The alliance's server, for "watch a game event"; null while unknown. */
  serverId: number | null;
  zone: string;
}

export function AlarmBoardsPanel({ boards, serverId, zone }: AlarmBoardsPanelProps) {
  const headingId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const { data: channels } = useChannelNames();
  const { data: routing } = useReminderRouting();

  const steps = (board: AlarmBoard) => {
    const labels = boardDefaultSteps(board).map((step) => stepLabel(step, zone));
    return labels.length === 0 ? 'no alarms' : `alarms ${labels.join(', ')}`;
  };

  return (
    <section aria-labelledby={headingId} className="panel alarm-boards">
      <h3 id={headingId}>Boards</h3>
      <p className="subtle">
        A change reaches entries filed from now on. Entries already listed keep their alarms until
        "Back to board defaults" is pressed on them.
      </p>
      <ul className="alarm-board-list">
        {boards.map((board) => (
          <li className="alarm-entry" key={board.category}>
            <div className="alarm-head">
              <span className="alarm-title">{board.label}</span>
              <span className="alarm-source">{board.kind}</span>
              <span>
                {board.channel === null ? 'alliance reminder channel' : `#${board.channel}`}
              </span>
              <span className="subtle">
                {steps(board)} ·{' '}
                {board.pingRoleId === null ? 'no ping' : `pings ${board.pingRoleId}`}
              </span>
              <button
                aria-expanded={editing === board.category}
                aria-label={`${editing === board.category ? 'Close' : 'Edit'}: ${board.label}`}
                className="linklike"
                onClick={() => setEditing(editing === board.category ? null : board.category)}
                type="button"
              >
                {editing === board.category ? 'Close' : 'Edit'}
              </button>
            </div>
            {channels !== undefined &&
              routing !== undefined &&
              nothingWillBeSent(board.channel, channels, routing) && (
                <p className="alarm-warn">Nothing will be sent: {silenceReason(board.channel)}</p>
              )}
            {editing === board.category && (
              <BoardEditor
                board={board}
                boards={boards}
                channels={channels ?? []}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
      {boards.length === 0 && <p className="empty">No boards yet.</p>}
      {serverId === null ? (
        <p className="subtle">
          The alliance's server is not known yet, so the game's events cannot be listed to watch.
        </p>
      ) : (
        <WatchGameEvent boards={boards} serverId={serverId} zone={zone} />
      )}
    </section>
  );
}
