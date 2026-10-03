// An event's name, and for officers and admins the form that renames it and
// says whether it is an event or a shop. RLS is the gate (0208); this only
// decides whether to offer the form.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type CalendarEvent, type Category, labelOf, saveEventName } from './data';

export function EventName({ event, mayName }: { event: CalendarEvent; mayName: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; category: Category } | null>(null);
  const save = useMutation({
    mutationFn: (value: { name: string; category: Category }) =>
      saveEventName(event.activity_id, value.name, value.category),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['event-calendar'] });
    },
  });

  if (draft === null) {
    return (
      <>
        <span className={event.name === null ? 'calendar-unnamed' : undefined}>
          {labelOf(event)}
        </span>
        {event.category === 'shop' && <span className="calendar-shop-tag">Shop</span>}
        {mayName && (
          <button
            aria-label={`Edit ${labelOf(event)}`}
            className="calendar-name-button"
            onClick={() =>
              setDraft({ name: event.name ?? '', category: event.category ?? 'event' })
            }
            type="button"
          >
            {event.name === null ? 'Name it' : 'Edit'}
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <form
        className="row"
        onSubmit={(submit) => {
          submit.preventDefault();
          save.mutate(draft);
        }}
      >
        <input
          aria-label={`Name for event ${event.activity_id}`}
          maxLength={80}
          onChange={(change) => setDraft({ ...draft, name: change.target.value })}
          placeholder={`Event #${event.activity_id}`}
          value={draft.name}
        />
        <select
          aria-label="Event or shop"
          onChange={(change) => setDraft({ ...draft, category: change.target.value as Category })}
          value={draft.category}
        >
          <option value="event">Event</option>
          <option value="shop">Shop / pass / pack</option>
        </select>
        <button disabled={save.isPending} type="submit">
          Save
        </button>
        <button onClick={() => setDraft(null)} type="button">
          Cancel
        </button>
      </form>
      {save.error && <p className="error">{save.error.message}</p>}
      <p className="subtle">
        Leave the name empty and save to remove it. Your edit is kept when the game's names are
        refreshed.
      </p>
    </>
  );
}
