// The card an event opens: when it runs, what it needs, and what the game
// itself says it is (event_names.summary / rules, 0339 — the client's own
// text, read when the card opens rather than with the whole calendar).
//
// A native <dialog>, like the command palette: it traps focus, closes on
// Escape and announces itself, none of which a positioned div does.
//
// An unidentified event has no text to show — the client has no row for its
// id — so its card says exactly that, and offers officers the naming form.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { EventName } from './EventName';
import {
  CATEGORY_LABELS,
  type CalendarEvent,
  categoryOf,
  fetchEventText,
  isUnidentified,
  labelOf,
  serverWhen,
  statusOf,
} from './data';

/** The game's text changes with a client update, not during a visit. */
const STALE_TIME = 60 * 60_000;

export function EventCard({
  event,
  now,
  mayName,
  onClose,
}: {
  event: CalendarEvent;
  now: Date;
  mayName: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const unidentified = isUnidentified(event);
  const text = useQuery({
    queryKey: ['event-text', event.activity_id],
    queryFn: () => fetchEventText(event.activity_id),
    staleTime: STALE_TIME,
    enabled: !unidentified,
  });

  useEffect(() => {
    const node = dialog.current;
    if (node !== null && !node.open) {
      // jsdom has no showModal; the attribute is enough for a test to read.
      if (typeof node.showModal === 'function') {
        node.showModal();
      } else {
        node.setAttribute('open', '');
      }
    }
  }, []);

  const category = categoryOf(event);
  const titleId = `event-card-${event.activity_id}`;

  return (
    <dialog
      aria-labelledby={titleId}
      className="notice-dialog calendar-card"
      onClick={(click) => {
        // A click on the backdrop lands on the dialog element itself.
        if (click.target === dialog.current) {
          onClose();
        }
      }}
      onClose={onClose}
      onKeyDown={(key) => {
        if (key.key === 'Escape') {
          onClose();
        }
      }}
      ref={dialog}
    >
      <header className="calendar-card-head">
        <div>
          <h3 className={unidentified ? 'calendar-unnamed' : undefined} id={titleId}>
            {labelOf(event)}
          </h3>
          <p className="calendar-card-tags">
            {unidentified ? (
              <span className="badge">Unidentified</span>
            ) : (
              <span
                className={`calendar-bar calendar-bar-start calendar-bar-end calendar-cat-${category}`}
              >
                {CATEGORY_LABELS[category]}
              </span>
            )}
            <span className="subtle">{statusOf(event, now)}</span>
          </p>
        </div>
        <button aria-label="Close" className="calendar-card-close" onClick={onClose} type="button">
          ×
        </button>
      </header>

      <dl className="calendar-card-facts">
        <div>
          <dt>Starts</dt>
          <dd>{serverWhen(event.starts_at, now)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{serverWhen(event.ends_at, now)}</dd>
        </div>
        <div>
          <dt>HQ level</dt>
          <dd>{event.need_hq_level ? `${event.need_hq_level}+` : 'Any'}</dd>
        </div>
        <div>
          <dt>Game id</dt>
          <dd>
            {event.activity_id}
            {event.activity_type !== null && (
              <span className="subtle"> · type {event.activity_type}</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="subtle">Server time, UTC−2.</p>

      {unidentified ? (
        <p>
          The server lists this id, but the game client's event table has no entry for it — so there
          is no name, description or rules to show, and the game itself does not show it either. It
          is kept off the calendar until someone names it.
        </p>
      ) : text.isPending ? (
        <p className="empty">Loading what the game says…</p>
      ) : text.isError ? (
        <p className="error">Could not load the description: {text.error.message}</p>
      ) : text.data.summary === null && text.data.rules === null ? (
        <p className="empty">The game has no description for this event.</p>
      ) : (
        <>
          {text.data.summary !== null && <p className="calendar-card-text">{text.data.summary}</p>}
          {text.data.rules !== null && (
            <>
              <h4>Rules</h4>
              <p className="calendar-card-text">{text.data.rules}</p>
            </>
          )}
          <p className="subtle">From the game client's own text.</p>
        </>
      )}

      {mayName && (
        <div className="calendar-card-edit">
          <EventName event={event} mayName />
        </div>
      )}
    </dialog>
  );
}
