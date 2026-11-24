// An event's name, and for officers and admins the form that renames it and
// puts it in a category. RLS is the gate (0208); this only
// decides whether to offer the form.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { useEditMode } from '../../lib/editMode';
import { useT } from '../../lib/i18n';
import { CALENDAR_HIDDEN_EVENTS } from '../../lib/settings/registry';
import { useSaveSiteSetting } from '../../lib/settings/useSiteSetting';
import { useCalendarConfig } from './categories';
import { type CalendarEvent, categoryOf, labelOf, saveEventName } from './data';

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
  const config = useCalendarConfig();
  const { editing } = useEditMode();
  const saveSetting = useSaveSiteSetting();
  const [draft, setDraft] = useState<{ name: string; category: string } | null>(null);
  const save = useMutation({
    mutationFn: (value: { name: string; category: string }) =>
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
            onClick={() =>
              setDraft({ name: event.name ?? '', category: categoryOf(event, config.knownKeys) })
            }
            type="button"
          >
            {event.name === null ? t('Name it') : t('Edit')}
          </button>
        )}
        {/* Edit mode (admins): file the event and hide it without opening the
            form. Filing needs a name, the column it is kept in (0208). */}
        {editing && (
          <span className="calendar-quick">
            <Select
              aria-label={t('Category of {name}', { name: labelOf(event, t) })}
              disabled={event.name === null || save.isPending}
              onChange={(chosen) => save.mutate({ name: event.name ?? '', category: chosen })}
              title={event.name === null ? t('Name it first to file it.') : undefined}
              value={categoryOf(event, config.knownKeys)}
            >
              {config.all.map((category) => (
                <option key={category.key} value={category.key}>
                  {config.label(category.key, t)}
                  {category.hidden ? ` (${t('hidden')})` : ''}
                </option>
              ))}
            </Select>
            <button
              disabled={saveSetting.isPending}
              onClick={() => {
                const hidden = config.hiddenEvents.has(event.activity_id);
                const next = hidden
                  ? [...config.hiddenEvents].filter((id) => id !== event.activity_id)
                  : [...config.hiddenEvents, event.activity_id];
                saveSetting.mutate({
                  setting: CALENDAR_HIDDEN_EVENTS,
                  value: next.length === 0 ? null : next,
                });
              }}
              type="button"
            >
              {config.hiddenEvents.has(event.activity_id) ? t('Show') : t('Hide')}
            </button>
          </span>
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
          onChange={(chosen) => setDraft({ ...draft, category: chosen })}
          value={draft.category}
        >
          {config.all.map((category) => (
            <option key={category.key} value={category.key}>
              {config.label(category.key, t)}
              {category.hidden ? ` (${t('hidden')})` : ''}
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
