import { useId, useState } from 'react';
import { useChannelNames } from '../../lib/channels';
import { NewBoardForm, WatchGameEvent } from './AlarmBoardAdd';
import { AlarmBoardEditor } from './AlarmBoardEditor';
import {
  type AlarmBoard,
  boardDefaultSteps,
  nothingWillBeSent,
  silenceReason,
  stepLabel,
} from './alarmLogic';
import { useReminderRouting } from './alarms';

/** Boards, for an officer (spec §1, §4, §8): each kind of event, where its
 * alarms go, the role they ping, when they go out and what they say.
 *
 * A CHANGE HERE REACHES ENTRIES FILED AFTERWARDS ONLY. 0322 copies a board's
 * steps onto an entry when it is filed, so the entries already listed keep
 * theirs; "Back to board defaults" on one brings it up to date.
 *
 * The editor (with delete) is `AlarmBoardEditor`; the two ways to add a board
 * are in `AlarmBoardAdd`.
 */

export interface AlarmBoardsPanelProps {
  boards: readonly AlarmBoard[];
  /** The boards query failed: an empty list here is not "no boards". */
  failed: boolean;
  loading: boolean;
  /** The alliance's server, for "watch a game event"; null while unknown. */
  serverId: number | null;
  zone: string;
}

export function AlarmBoardsPanel({
  boards,
  failed,
  loading,
  serverId,
  zone,
}: AlarmBoardsPanelProps) {
  const headingId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data: channels } = useChannelNames();
  const { data: routing } = useReminderRouting();

  const steps = (board: AlarmBoard) => {
    const labels = boardDefaultSteps(board).map((step) => stepLabel(step, zone));
    return labels.length === 0 ? 'no alarms' : `alarms ${labels.join(', ')}`;
  };

  return (
    <section aria-labelledby={headingId} className="panel alarm-boards">
      <div className="toolbar alarm-toolbar">
        <h3 id={headingId}>Boards</h3>
        {/* A new board's key is checked against the list: not before it loads. */}
        {!failed && !loading && (
          <button aria-expanded={adding} onClick={() => setAdding(!adding)} type="button">
            New board
          </button>
        )}
      </div>
      <p className="subtle">
        A change reaches entries filed from now on. Entries already listed keep their alarms until
        "Back to board defaults" is pressed on them.
      </p>
      {adding && <NewBoardForm boards={boards} onDone={() => setAdding(false)} />}
      {failed && <p className="error">The boards could not be read.</p>}
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
              <AlarmBoardEditor
                board={board}
                boards={boards}
                channels={channels ?? []}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
      {loading && <p className="empty loading">Loading…</p>}
      {!failed && !loading && boards.length === 0 && <p className="empty">No boards yet.</p>}
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
