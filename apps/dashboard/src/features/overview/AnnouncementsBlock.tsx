import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RichText } from '../../components/RichText';
import { supabase } from '../../lib/supabase';

/** Notices an admin wrote, on the screen everyone lands on.
 *
 * TITLES ONLY, and the body in a dialog. Three standing notices with bodies took
 * more of the landing screen than the figures the screen is for, and a notice
 * board that pushes the alliance's numbers below the fold gets the numbers read
 * less rather than the notices read more.
 *
 * A native `<dialog>` rather than a div with a high z-index: it traps focus,
 * closes on Escape, and reports itself to a screen reader as a dialog, none of
 * which a div does without a few hundred lines of imitation.
 *
 * The query does not filter by visibility — RLS already did, and repeating the
 * rule in the client would give it two places to be wrong. What comes back is
 * what this reader may see, whoever they are.
 *
 * Expiry IS filtered here rather than in a view: `ends_at > now()` cannot live in
 * an index predicate (now() is not immutable) and a view would hide the rule from
 * the one place that has to explain it.
 */
export interface Announcement {
  announcement_id: string;
  title: string;
  body: string;
  starts_at: string | null;
  ends_at: string | null;
  pinned: boolean;
  visibility: string;
  /** When it was written. Distinct from `starts_at`, which is when it becomes
   * current — a notice posted today for next Saturday has both, and the reader
   * wants to know how old the writing is. */
  created_at: string;
}

async function fetchAnnouncements(): Promise<Announcement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('announcements')
    .select('announcement_id, title, body, starts_at, ends_at, pinned, visibility, created_at')
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('pinned', { ascending: false })
    .order('starts_at', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`announcements query failed: ${error.message}`);
  }
  return data ?? [];
}

const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

function windowLabel(a: Announcement): string | null {
  if (a.starts_at === null && a.ends_at === null) {
    return null;
  }
  const from = a.starts_at ? when.format(new Date(a.starts_at)) : null;
  const to = a.ends_at ? when.format(new Date(a.ends_at)) : null;
  // UTC throughout, spelled out. The game week resets at 02:00 UTC and the
  // alliance spans eight servers' worth of people in different places; a
  // notice that says "Saturday 2am" in the reader's own zone is the one way
  // to get everybody there at a different time.
  if (from && to) {
    return `${from} – ${to} UTC`;
  }
  return from ? `from ${from} UTC` : `until ${to} UTC`;
}

/** The body of one notice, in a modal.
 *
 * `showModal()` from an effect rather than the `open` attribute: `open` renders a
 * dialog that is visible but NOT modal — no focus trap, no Escape, no backdrop.
 * The two look identical until somebody tries to tab out of it.
 *
 * No click-the-backdrop-to-close. It needs a click handler on the dialog itself,
 * which `lint/a11y/useKeyWithClickEvents` flags and which cannot be suppressed
 * from inside a JSX attribute list. Escape closes it natively and there is a
 * Close button, so the nicety was not worth an unsuppressible warning standing in
 * the build forever.
 */
function NoticeDialog({ notice, onClose }: { notice: Announcement; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      className="notice-dialog"
      // Escape fires `cancel`, and the browser then closes it without telling
      // React — so the state has to be cleared here or reopening the same notice
      // does nothing.
      onCancel={onClose}
      onClose={onClose}
      ref={ref}
    >
      <h3>{notice.title}</h3>
      <p className="subtle">
        Posted {day.format(new Date(notice.created_at))} UTC
        {windowLabel(notice) && ` · ${windowLabel(notice)}`}
      </p>
      {/* A small markup subset — bold, italic, code, links, bullets, headings —
          parsed into React elements by `lib/richText`. Never HTML: nothing hands
          the body to the DOM as markup, so a `<script>` an author types renders
          as those characters rather than being stripped by a sanitizer that has
          to stay ahead of every trick. Link hrefs are allowlisted to http(s).
          Emoji were always fine; they are just characters. */}
      {notice.body.trim() !== '' ? (
        <RichText body={notice.body} />
      ) : (
        <p className="empty">This notice has no body — the title is all of it.</p>
      )}
      <button onClick={() => ref.current?.close()} type="button">
        Close
      </button>
    </dialog>
  );
}

export function AnnouncementsBlock() {
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, isPending } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
  });

  // Nothing to say is not worth a heading and an empty box on the landing
  // screen. An admin who wants to know whether any exist has the settings
  // page for that.
  if (isPending || (data !== undefined && data.length === 0 && error === null)) {
    return null;
  }

  const notices = data ?? [];
  const opened = notices.find((item) => item.announcement_id === open) ?? null;

  return (
    <section aria-labelledby="announcements-heading">
      <h2 id="announcements-heading">Notices</h2>
      {error && <p className="error">Could not load notices: {error.message}</p>}
      <ul className="notices">
        {notices.map((item) => (
          <li
            className={item.pinned ? 'notice notice-pinned' : 'notice'}
            key={item.announcement_id}
          >
            {/* A button, not the li itself: opening a dialog is an action, and a
                clickable li is invisible to the keyboard. */}
            <button
              className="notice-open"
              onClick={() => setOpen(item.announcement_id)}
              type="button"
            >
              <span className="notice-title">{item.title}</span>
              <span className="subtle">{day.format(new Date(item.created_at))}</span>
              {item.pinned && <span className="badge badge-fresh">pinned</span>}
              {item.visibility === 'member' && <span className="badge">alliance</span>}
            </button>
          </li>
        ))}
      </ul>
      {opened !== null && <NoticeDialog notice={opened} onClose={() => setOpen(null)} />}
    </section>
  );
}
