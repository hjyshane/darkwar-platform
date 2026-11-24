// The Site values editors a generic field cannot draw (registry `custom`
// fields): the calendar's categories, its hidden events, and the events the
// alliance overview always lists. Settings is English for admins (owner,
// 2026-11-24), so nothing here goes through t().
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { english } from '../../lib/i18n/core';
import type { CustomEditor } from '../../lib/settings/registry';
import {
  type CalendarCategoryDef,
  MAX_CATEGORIES,
  calendarConfig,
  isBuiltIn,
  newCategoryKey,
} from '../calendar/categoryModel';
import { fetchCalendar, labelOf } from '../calendar/data';
import { fetchAllEventKinds } from '../participation/data';

export function CustomFieldEditor({
  editor,
  value,
  onChange,
}: {
  editor: CustomEditor;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  switch (editor) {
    case 'calendar-categories':
      return (
        <CalendarCategoriesEditor
          onChange={onChange}
          value={Array.isArray(value) ? (value as CalendarCategoryDef[]) : []}
        />
      );
    case 'calendar-hidden-events':
      return (
        <HiddenEventsEditor
          onChange={onChange}
          value={Array.isArray(value) ? (value as string[]) : []}
        />
      );
    case 'event-kinds':
      return (
        <EventKindsEditor
          onChange={onChange}
          value={Array.isArray(value) ? (value as string[]) : []}
        />
      );
  }
}

function CalendarCategoriesEditor({
  value,
  onChange,
}: {
  value: readonly CalendarCategoryDef[];
  onChange: (next: CalendarCategoryDef[]) => void;
}) {
  const [adding, setAdding] = useState('');
  const names = calendarConfig(value, [], 180);
  const update = (index: number, patch: Partial<CalendarCategoryDef>) =>
    onChange(value.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    const [entry] = next.splice(index, 1);
    if (entry === undefined) return;
    next.splice(index + by, 0, entry);
    onChange(next);
  };
  const full = value.length >= MAX_CATEGORIES;
  const add = () => {
    const label = adding.trim();
    if (label === '' || full) return;
    const key = newCategoryKey(label, new Set(value.map((entry) => entry.key)));
    onChange([...value, { key, label, hidden: false, shownAtFirst: true }]);
    setAdding('');
  };

  return (
    <div className="site-categories">
      <table>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Name</th>
            <th scope="col">Shown at first</th>
            <th scope="col">Hidden</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {value.map((entry, index) => (
            <tr key={entry.key}>
              <td>
                <button
                  aria-label={`Move ${names.label(entry.key, english)} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  ↑
                </button>{' '}
                <button
                  aria-label={`Move ${names.label(entry.key, english)} down`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  ↓
                </button>
              </td>
              <td>
                <input
                  aria-label={`Name of ${names.label(entry.key, english)}`}
                  maxLength={40}
                  onChange={(event) =>
                    update(index, {
                      label:
                        event.target.value === '' && isBuiltIn(entry.key)
                          ? null
                          : event.target.value,
                    })
                  }
                  placeholder={isBuiltIn(entry.key) ? names.label(entry.key, english) : ''}
                  value={entry.label ?? ''}
                />
                {isBuiltIn(entry.key) && <span className="subtle"> built in</span>}
              </td>
              <td>
                <input
                  aria-label={`${names.label(entry.key, english)} shown at first`}
                  checked={entry.shownAtFirst}
                  onChange={(event) => update(index, { shownAtFirst: event.target.checked })}
                  type="checkbox"
                />
              </td>
              <td>
                <input
                  aria-label={`${names.label(entry.key, english)} hidden`}
                  checked={entry.hidden}
                  onChange={(event) => update(index, { hidden: event.target.checked })}
                  type="checkbox"
                />
              </td>
              <td>
                {/* A built-in cannot go: events filed under it would lose their
                    place. Hide it instead. */}
                {!isBuiltIn(entry.key) && (
                  <button
                    onClick={() => onChange(value.filter((_, at) => at !== index))}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="site-map-add">
        <label htmlFor="calendar-category-add">
          New category{' '}
          <input
            id="calendar-category-add"
            maxLength={40}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
            value={adding}
          />
        </label>{' '}
        <button disabled={adding.trim() === '' || full} onClick={add} type="button">
          Add
        </button>
        {full && (
          <span className="subtle"> The list is full ({MAX_CATEGORIES}). Remove one first.</span>
        )}
      </p>
      <p className="subtle">
        Events are filed from the Game calendar: officers with Edit next to an event's name, admins
        straight from the list in edit mode. Removing a category you added puts its events back
        under Events.
      </p>
    </div>
  );
}

function HiddenEventsEditor({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const calendar = useQuery({ queryKey: ['event-calendar'], queryFn: fetchCalendar });
  const byId = new Map((calendar.data ?? []).map((event) => [event.activity_id, event]));
  if (value.length === 0) {
    return (
      <p className="empty">
        No event is hidden. Turn on edit mode (Edit pages) and press Hide next to an event on the
        Game calendar.
      </p>
    );
  }
  return (
    <ul className="site-hidden-events">
      {value.map((id) => {
        const event = byId.get(id);
        return (
          <li key={id}>
            {event === undefined ? `Event #${id} (not on the current calendar)` : labelOf(event)}{' '}
            <button onClick={() => onChange(value.filter((other) => other !== id))} type="button">
              Show again
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EventKindsEditor({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const kinds = useQuery({ queryKey: ['attendance-kinds-all'], queryFn: fetchAllEventKinds });
  const listed = new Set(value);
  const known = (kinds.data ?? []).filter((kind) => !kind.archived);
  // A kind saved before it was archived or renamed is still offered, so it can
  // be taken off.
  const extra = value.filter((kind) => !known.some((entry) => entry.kind === kind));
  const toggle = (kind: string, on: boolean) =>
    onChange(on ? [...value, kind] : value.filter((other) => other !== kind));
  if (kinds.isPending) return <p className="empty loading">Loading the event list…</p>;
  return (
    <fieldset className="site-choices">
      <legend className="visually-hidden">Events always listed</legend>
      {known.map((kind) => (
        <label key={kind.kind}>
          <input
            checked={listed.has(kind.kind)}
            onChange={(event) => toggle(kind.kind, event.target.checked)}
            type="checkbox"
          />{' '}
          {kind.label}
        </label>
      ))}
      {extra.map((kind) => (
        <label key={kind}>
          <input checked onChange={() => toggle(kind, false)} type="checkbox" /> {kind}
        </label>
      ))}
    </fieldset>
  );
}
