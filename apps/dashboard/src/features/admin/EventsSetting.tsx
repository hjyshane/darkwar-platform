import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { type EventKind, eventKey, fetchAllEventKinds, saveEventKind } from '../participation/data';

const BOARD_LABEL: Record<EventKind['board'], string> = {
  event: 'Game events',
  season: 'Season events',
};

/** The events the participation report has a column for.
 *
 * Shared by every alliance (an event is a fact about the game, like a hero), so
 * a change here is seen everywhere. Nothing is ever deleted: taking an event off
 * the report is "archived", which hides it and keeps every tick already made.
 *
 * An event this form adds is ticked by an officer. Whether the collector also
 * reads it from a board is not something a form can say — that flag is set by
 * the collector's own change — so such events are shown as "captured" and their
 * flag is left alone.
 */
export function EventsSetting() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [board, setBoard] = useState<EventKind['board']>('event');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['attendance-kinds-all'],
    queryFn: fetchAllEventKinds,
  });

  const save = useMutation({
    mutationFn: saveEventKind,
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      // The list here, the report's columns, and the recorder's picker.
      queryClient.invalidateQueries({ queryKey: ['attendance-kinds-all'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-kinds'] });
      queryClient.invalidateQueries({ queryKey: ['participation'] });
    },
    onError: (saveError: Error) => {
      setFailed(true);
      setMessage(`Could not save: ${saveError.message}`);
    },
  });

  if (isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the events: {(error as Error).message}</p>;
  }

  const kinds = data ?? [];
  const key = eventKey(name);
  const taken = key !== null && kinds.some((entry) => entry.kind === key);
  const nextOrder = kinds.reduce((top, entry) => Math.max(top, entry.sort_order), 0) + 10;

  function add() {
    if (key === null || taken) {
      return;
    }
    save.mutate(
      { kind: key, label: name.trim(), board, sortOrder: nextOrder },
      {
        onSuccess: () => setName(''),
      },
    );
  }

  return (
    <div className="setting">
      <p className="note">
        The events the participation page has a column for. <strong>Game events</strong> and{' '}
        <strong>Season events</strong> are its two tabs. A new event is ticked by hand on the
        attendance form; on the same form an officer says which days it was held, so it does not
        read 0 held until the first tick. Archiving an event hides it and keeps everything already
        recorded. These are shared by every alliance.
      </p>

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor="event-name">
          New event
          <input
            id="event-name"
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Arena Cup"
            type="text"
            value={name}
          />
        </label>
        <label htmlFor="event-board">
          On the tab
          <Select
            id="event-board"
            onChange={(chosen) => setBoard(chosen as EventKind['board'])}
            value={board}
          >
            <option value="event">{BOARD_LABEL.event}</option>
            <option value="season">{BOARD_LABEL.season}</option>
          </Select>
        </label>
        <button
          className="primary"
          disabled={key === null || taken || save.isPending}
          type="submit"
        >
          Add
        </button>
      </form>
      {name.trim() !== '' && key === null && (
        <p className="error">
          The name needs some letters or digits in English: the event is stored under a key made
          from it.
        </p>
      )}
      {taken && <p className="error">There is already an event with the key “{key}”.</p>}
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th className="label" scope="col">
                Event
              </th>
              <th scope="col">Tab</th>
              <th className="num" scope="col">
                Order
              </th>
              <th scope="col">Source</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {kinds.map((entry) => (
              <EventRow
                entry={entry}
                key={entry.kind}
                onSave={(next) => save.mutate(next)}
                saving={save.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventRow({
  entry,
  onSave,
  saving,
}: {
  entry: EventKind;
  onSave: (next: {
    kind: string;
    label: string;
    board: 'event' | 'season';
    sortOrder?: number;
    archived?: boolean;
  }) => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(entry.label);
  const [order, setOrder] = useState(String(entry.sort_order));
  const parsedOrder = Number.parseInt(order, 10);
  const dirty =
    label.trim() !== entry.label ||
    (Number.isFinite(parsedOrder) && parsedOrder !== entry.sort_order);

  const common = {
    kind: entry.kind,
    label: label.trim() || entry.label,
    board: entry.board,
    sortOrder: Number.isFinite(parsedOrder) ? parsedOrder : entry.sort_order,
  };

  return (
    <tr className={entry.archived ? 'muted' : undefined}>
      <td className="label">
        <input
          aria-label={`Name of ${entry.label}`}
          maxLength={40}
          onChange={(event) => setLabel(event.target.value)}
          type="text"
          value={label}
        />
      </td>
      <td>
        <Select
          aria-label={`Tab for ${entry.label}`}
          disabled={saving}
          onChange={(chosen) =>
            onSave({ ...common, board: chosen as 'event' | 'season', archived: entry.archived })
          }
          value={entry.board}
        >
          <option value="event">{BOARD_LABEL.event}</option>
          <option value="season">{BOARD_LABEL.season}</option>
        </Select>
      </td>
      <td className="num">
        <input
          aria-label={`Order of ${entry.label}`}
          inputMode="numeric"
          onChange={(event) => setOrder(event.target.value)}
          type="number"
          value={order}
        />
      </td>
      <td>
        {entry.captured ? (
          <span title="The collector reads this event's board, so the report fills it in itself.">
            captured
          </span>
        ) : (
          <span className="muted" title="Ticked by an officer on the attendance form.">
            by hand
          </span>
        )}
      </td>
      <td>
        <span className="actions">
          <button
            disabled={!dirty || saving}
            onClick={() => onSave({ ...common, archived: entry.archived })}
            type="button"
          >
            Save
          </button>
          <button
            disabled={saving}
            onClick={() => onSave({ ...common, archived: !entry.archived })}
            type="button"
          >
            {entry.archived ? 'Restore' : 'Archive'}
          </button>
        </span>
      </td>
    </tr>
  );
}
