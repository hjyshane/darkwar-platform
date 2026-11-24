// An event's name, and for officers and admins the form that renames it and
// puts it in a category. RLS is the gate (0208); this only
// decides whether to offer the form.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { useT } from '../../lib/i18n';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type CalendarEvent,
  type Category,
  categoryOf,
  labelOf,
  saveEventName,
} from './data';

export function EventName({
  event,
  mayName,
  onOpen,
}: {
  event: CalendarEvent;
  mayName: boolean;
  /** Given, the name is a button that opens the event's card. */
  onOpen?: (event: CalendarEvent) => void;
}) {
  const t = useT();
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
        {onOpen === undefined ? (
          <span className={event.name === null ? 'calendar-unnamed' : undefined}>
            {labelOf(event, t)}
          </span>
        ) : (
          <button
            className={`calendar-open${event.name === null ? ' calendar-unnamed' : ''}`}
            onClick={() => onOpen(event)}
            type="button"
          >
            {labelOf(event, t)}
          </button>
        )}
        {mayName && (
          <button
            aria-label={t('Edit {name}', { name: labelOf(event, t) })}
            className="calendar-name-button"
            onClick={() => setDraft({ name: event.name ?? '', category: categoryOf(event) })}
            type="button"
          >
            {event.name === null ? t('Name it') : t('Edit')}
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
          aria-label={t('Name for event {id}', { id: event.activity_id })}
          maxLength={80}
          onChange={(change) => setDraft({ ...draft, name: change.target.value })}
          placeholder={t('Event #{id}', { id: event.activity_id })}
          value={draft.name}
        />
        <Select
          aria-label={t('Category')}
          onChange={(chosen) => setDraft({ ...draft, category: chosen as Category })}
          value={draft.category}
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(CATEGORY_LABELS[value])}
            </option>
          ))}
        </Select>
        <button disabled={save.isPending} type="submit">
          {t('Save')}
        </button>
        <button onClick={() => setDraft(null)} type="button">
          {t('Cancel')}
        </button>
      </form>
      {save.error && <p className="error">{save.error.message}</p>}
      <p className="subtle">
        {t(
          "Leave the name empty and save to remove it. Your edit is kept when the game's names are refreshed.",
        )}
      </p>
    </>
  );
}
