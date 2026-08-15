import { useQuery } from '@tanstack/react-query';
import { RichTitle } from '../../components/RichText';
import { noticeHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';

/** Notices an admin wrote, on the screen everyone lands on.
 *
 * PINNED ONLY. Every notice now has the Notices board and its own address, so
 * the landing screen's job is narrower than it was: carry the few that are meant
 * to be unmissable, and get out of the way of the figures. Pinning is the admin
 * saying "this one goes on the front".
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
    .eq('pinned', true)
    // Posted, not merely written (0108). RLS already hides a draft from every
    // reader who cannot write one, so this filter exists for the one reader it
    // does not hide it from: the admin who wrote it. The landing screen is where
    // they check the front page looks right, and a pinned half-sentence sitting
    // on it is exactly what they would be checking for.
    .not('published_at', 'is', null)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('starts_at', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`announcements query failed: ${error.message}`);
  }
  return data ?? [];
}

// Date only. The to-the-minute format went with the dialog: this block lists
// notices, and the notice's own page is where the exact time belongs.
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export function AnnouncementsBlock() {
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
            {/* A LINK TO THE NOTICE'S OWN PAGE, not a dialog.
                This opened a read-only dialog until notices gained comments
                (0113). The dialog had no thread and no way to reach one, so a
                member reading the front page — which on a phone is most of
                them — could see a notice and had nowhere to answer it. The
                post page is also the only renderer that stays in step with the
                board; the dialog was a second copy of "how a notice looks",
                and it has gone with this change. */}
            <a className="notice-open" href={noticeHash(item.announcement_id)}>
              <span className="notice-title">
                <RichTitle title={item.title} />
              </span>
              <span className="subtle">{day.format(new Date(item.created_at))}</span>
              {item.pinned && <span className="badge badge-fresh">pinned</span>}
              {item.visibility === 'member' && <span className="badge">alliance</span>}
            </a>
          </li>
        ))}
      </ul>
      <p className="subtle">
        <a href="#/notices">All notices →</a>
      </p>
    </section>
  );
}
