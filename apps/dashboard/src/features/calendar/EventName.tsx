// An event's name, and for officers and admins the form that renames it and
// puts it in a category. RLS is the gate (0208); this only
// decides whether to offer the form.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type CalendarEvent,
  type Category,
  categoryOf,
  labelOf,
  saveEventName,
} from './data';

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
        {mayName && (
          <button
            aria-label={`Edit ${labelOf(event)}`}
            className="calendar-name-button"
            onClick={() => setDraft({ name: event.name ?? '', category: categoryOf(event) })}
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
        <Select
          aria-label="Category"
          onChange={(chosen) => setDraft({ ...draft, category: chosen as Category })}
          value={draft.category}
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </Select>
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
