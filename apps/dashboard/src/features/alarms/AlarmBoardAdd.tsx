import { useId, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { type AlarmBoard, shortDate } from './alarmLogic';
import { useCreateBoard, useGameEventsForServer, useWatchGameEvent } from './alarms';
import { watchableEvents } from './boardLogic';

/** The two ways a board is added, for an officer: one of the alliance's own,
 * named here (how a manual entry gets alarms with settings of its own), and
 * one following a game event (spec §3). Split from `AlarmBoardsPanel`. */

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "New board": a name and a kind. Everything else starts at the database's
 *  defaults and is set with Edit afterwards. */
export function NewBoardForm({
  boards,
  onDone,
}: { boards: readonly AlarmBoard[]; onDone: () => void }) {
  const formId = useId();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AlarmBoard['kind']>('point');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateBoard();

  async function commit() {
    setProblem(null);
    try {
      await create.mutateAsync({ label, kind, taken: boards.map((board) => board.category) });
      onDone();
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  return (
    <div className="alarm-panel">
      <div className="row">
        <div className="field">
          <label htmlFor={`${formId}-label`}>Board name</label>
          <input
            id={`${formId}-label`}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            value={label}
          />
        </div>
        <fieldset className="field">
          <legend>Board kind</legend>
          <label>
            <input
              checked={kind === 'point'}
              name={`${formId}-kind`}
              onChange={() => setKind('point')}
              type="radio"
            />{' '}
            A moment: alarms before it starts
          </label>{' '}
          <label>
            <input
              checked={kind === 'window'}
              name={`${formId}-kind`}
              onChange={() => setKind('window')}
              type="radio"
            />{' '}
            A window: when it opens and before it closes
          </label>
        </fieldset>
      </div>
      <p className="subtle">
        It starts with the usual alarms (12 h, 1 h and 5 min, or open and before it closes) and the
        alliance reminder channel; Edit changes them.
      </p>
      {problem !== null && <p className="error">{problem}</p>}
      <div className="alarm-actions">
        <button disabled={create.isPending} onClick={commit} type="button">
          {create.isPending ? 'Adding…' : 'Add board'}
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
export function WatchGameEvent({
  boards,
  serverId,
  zone,
}: { boards: readonly AlarmBoard[]; serverId: number; zone: string }) {
  const formId = useId();
  const [chosen, setChosen] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const events = useGameEventsForServer(serverId);
  const watch = useWatchGameEvent();
  const offered = watchableEvents(events.data ?? [], boards);
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
      setProblem(errorText(error));
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
        lists it. Zombie Siege and Frankie are not listed: their alarms follow the times the
        alliance picks.
      </p>
      {problem !== null && <p className="error">{problem}</p>}
    </div>
  );
}
